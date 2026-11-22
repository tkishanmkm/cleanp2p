-- Bind each EVM hot-wallet nonce reservation to its gas-funding operation.
-- A retry after a crash must reuse the same nonce rather than consuming a new one.

BEGIN;

ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS funding_wallet_address TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gas_funding_network_wallet_nonce
    ON public.gas_funding_operations (network, funding_wallet_address, nonce)
    WHERE nonce IS NOT NULL AND funding_wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gas_funding_unresolved_wallet_nonce
    ON public.gas_funding_operations (network, funding_wallet_address, nonce)
    WHERE nonce IS NOT NULL
      AND funding_wallet_address IS NOT NULL
      AND status NOT IN ('CONFIRMED', 'FAILED');

CREATE OR REPLACE FUNCTION public.allocate_gas_funding_nonce(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_network TEXT,
    p_wallet_address TEXT,
    p_onchain_pending_nonce BIGINT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_network TEXT;
    v_chain_id INTEGER;
    v_wallet TEXT := lower(pg_catalog.btrim(coalesce(p_wallet_address, '')));
    v_current_nonce BIGINT;
    v_allocated_nonce BIGINT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for gas-funding nonce allocation'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR p_onchain_pending_nonce IS NULL
       OR p_onchain_pending_nonce < 0
       OR v_wallet !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'Invalid gas-funding nonce allocation payload'
            USING ERRCODE = '22023';
    END IF;

    v_network := CASE upper(pg_catalog.btrim(coalesce(p_network, '')))
        WHEN 'ETH' THEN 'ERC20'
        WHEN 'ETHEREUM' THEN 'ERC20'
        WHEN 'ERC20' THEN 'ERC20'
        WHEN 'BSC' THEN 'BEP20'
        WHEN 'BINANCE' THEN 'BEP20'
        WHEN 'BEP20' THEN 'BEP20'
        ELSE NULL
    END;

    IF v_network IS NULL THEN
        RAISE EXCEPTION 'Unsupported EVM gas-funding network'
            USING ERRCODE = '22023';
    END IF;

    v_chain_id := CASE WHEN v_network = 'ERC20' THEN 1 ELSE 56 END;

    -- Lock sweep, then funding row; all worker paths use this ordering.
    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
       OR upper(coalesce(v_sweep.status, '')) <> 'GAS_FUNDING' THEN
        RAISE EXCEPTION 'Active GAS_FUNDING sweep lease is required'
            USING ERRCODE = '42501';
    END IF;

    IF (CASE upper(pg_catalog.btrim(coalesce(v_sweep.network, '')))
        WHEN 'ETH' THEN 'ERC20'
        WHEN 'ETHEREUM' THEN 'ERC20'
        WHEN 'ERC20' THEN 'ERC20'
        WHEN 'BSC' THEN 'BEP20'
        WHEN 'BINANCE' THEN 'BEP20'
        WHEN 'BEP20' THEN 'BEP20'
        ELSE NULL
    END) IS DISTINCT FROM v_network THEN
        RAISE EXCEPTION 'Gas-funding nonce request does not match the claimed sweep network'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_gas.worker_id IS DISTINCT FROM p_worker_id
       OR v_gas.deposit_address IS DISTINCT FROM v_sweep.deposit_address
       OR upper(v_gas.network) IS DISTINCT FROM v_network
       OR upper(coalesce(v_gas.status, '')) <> 'PENDING' THEN
        RAISE EXCEPTION 'A worker-owned PENDING gas-funding operation is required'
            USING ERRCODE = '55000';
    END IF;

    -- Idempotent recovery: reuse the exact nonce already attached to this operation.
    IF v_gas.nonce IS NOT NULL THEN
        IF v_gas.nonce < 0 OR v_gas.nonce = 9223372036854775807
           OR lower(coalesce(v_gas.funding_wallet_address, '')) <> v_wallet THEN
            RAISE EXCEPTION 'Existing gas-funding nonce is invalid or belongs to a different hot wallet'
                USING ERRCODE = '23514';
        END IF;
        RETURN v_gas.nonce;
    END IF;

    INSERT INTO public.hot_wallet_nonces (chain_id, current_nonce, updated_at)
    VALUES (v_chain_id, p_onchain_pending_nonce, pg_catalog.clock_timestamp())
    ON CONFLICT (chain_id) DO NOTHING;

    SELECT current_nonce
      INTO v_current_nonce
    FROM public.hot_wallet_nonces
    WHERE chain_id = v_chain_id
    FOR UPDATE;

    IF v_current_nonce IS NULL OR v_current_nonce < 0
       OR v_current_nonce = 9223372036854775807 THEN
        RAISE EXCEPTION 'Hot-wallet nonce registry row is missing or outside the allocatable range'
            USING ERRCODE = '22003';
    END IF;

    -- This check is deliberately performed AFTER locking the chain nonce row.
    -- Concurrent workers for the same hot wallet therefore cannot both observe
    -- "no unresolved operation" and allocate adjacent nonces simultaneously.
    IF EXISTS (
        SELECT 1
        FROM public.gas_funding_operations AS prior
        WHERE prior.sweep_id <> p_sweep_id
          AND prior.network = v_network
          AND lower(coalesce(prior.funding_wallet_address, '')) = v_wallet
          AND prior.nonce IS NOT NULL
          AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
    ) THEN
        RAISE EXCEPTION 'An earlier gas-funding nonce for this hot wallet is unresolved; reconcile it before allocating another'
            USING ERRCODE = '55P03';
    END IF;

    v_allocated_nonce := GREATEST(v_current_nonce, p_onchain_pending_nonce);
    IF v_allocated_nonce < 0 OR v_allocated_nonce >= 9223372036854775807 THEN
        RAISE EXCEPTION 'Hot-wallet nonce is outside the allocatable range'
            USING ERRCODE = '22003';
    END IF;

    UPDATE public.hot_wallet_nonces
    SET current_nonce = v_allocated_nonce + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE chain_id = v_chain_id;

    UPDATE public.gas_funding_operations
    SET nonce = v_allocated_nonce,
        funding_wallet_address = v_wallet,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_gas.id
      AND worker_id = p_worker_id
      AND status = 'PENDING'
      AND nonce IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Allocated hot-wallet nonce could not be attached to gas-funding operation'
            USING ERRCODE = '55000';
    END IF;

    RETURN v_allocated_nonce;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_gas_funding_operation(
    p_sweep_id UUID,
    p_deposit_address TEXT,
    p_network TEXT,
    p_amount_allocated NUMERIC,
    p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_network TEXT;
    v_sweep_network TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required for custodial gas funding'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR p_deposit_address IS NULL OR pg_catalog.btrim(p_deposit_address) = ''
       OR p_network IS NULL OR pg_catalog.btrim(p_network) = ''
       OR p_amount_allocated IS NULL OR p_amount_allocated <= 0
       OR p_amount_allocated >= 1000000000000000000 THEN
        RAISE EXCEPTION 'Invalid custodial gas-funding claim payload'
            USING ERRCODE = '22023';
    END IF;

    v_network := CASE upper(pg_catalog.btrim(p_network))
        WHEN 'TRON' THEN 'TRC20'
        WHEN 'ETH' THEN 'ERC20'
        WHEN 'ETHEREUM' THEN 'ERC20'
        WHEN 'BSC' THEN 'BEP20'
        WHEN 'BINANCE' THEN 'BEP20'
        ELSE upper(pg_catalog.btrim(p_network))
    END;

    IF v_network NOT IN ('ERC20', 'BEP20', 'TRC20') THEN
        RAISE EXCEPTION 'Unsupported custodial gas-funding network %', v_network
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION 'Gas-funding worker does not own a live sweep lease'
            USING ERRCODE = '42501';
    END IF;

    IF upper(coalesce(v_sweep.status, '')) NOT IN ('GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Sweep is not in GAS_FUNDING or GAS_FUNDED recovery state'
            USING ERRCODE = '55000';
    END IF;

    v_sweep_network := CASE upper(pg_catalog.btrim(v_sweep.network))
        WHEN 'TRON' THEN 'TRC20'
        WHEN 'ETH' THEN 'ERC20'
        WHEN 'ETHEREUM' THEN 'ERC20'
        WHEN 'BSC' THEN 'BEP20'
        WHEN 'BINANCE' THEN 'BEP20'
        ELSE upper(pg_catalog.btrim(v_sweep.network))
    END;

    IF v_sweep_network IS DISTINCT FROM v_network
       OR v_sweep.deposit_address IS DISTINCT FROM p_deposit_address THEN
        RAISE EXCEPTION 'Gas-funding request does not match the claimed sweep destination/network'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_gas.deposit_address IS DISTINCT FROM p_deposit_address
           OR upper(v_gas.network) IS DISTINCT FROM v_network THEN
            RAISE EXCEPTION 'Existing gas-funding operation does not match this sweep'
                USING ERRCODE = '23514';
        END IF;

        IF v_gas.status = 'CONFIRMED' THEN
            IF nullif(pg_catalog.btrim(coalesce(v_gas.tx_hash, '')), '') IS NULL THEN
                RAISE EXCEPTION 'Confirmed gas-funding operation has no transaction hash; reconciliation required';
            END IF;
            UPDATE public.gas_funding_operations
            SET worker_id = p_worker_id,
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_gas.id
            RETURNING * INTO v_gas;
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'already_funded', true,
                'status', v_gas.status,
                'tx_hash', v_gas.tx_hash,
                'signed_tx_hex', v_gas.signed_tx_hex,
                'nonce', v_gas.nonce,
                'amount_allocated', v_gas.amount_allocated
            );
        END IF;

        -- A RECOVERY_REQUIRED claim with no reserved nonce and no signed
        -- transaction identity is provably pre-signing. Retry the policy and
        -- solvency checks under the new worker lease. Never recycle an allocated
        -- nonce or any operation that has a tx hash or signed bytes.
        IF upper(coalesce(v_gas.status, '')) = 'RECOVERY_REQUIRED'
           AND nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL
           AND nullif(pg_catalog.btrim(coalesce(v_gas.tx_hash, '')), '') IS NULL THEN
            IF v_gas.nonce IS NULL AND v_gas.funding_wallet_address IS NULL THEN
                -- Failure before nonce reservation: a new policy/solvency check
                -- may safely retry with a recalculated funding amount.
                UPDATE public.gas_funding_operations
                SET status = 'PENDING',
                    amount_allocated = p_amount_allocated,
                    worker_id = p_worker_id,
                    error_message = NULL,
                    updated_at = pg_catalog.clock_timestamp()
                WHERE id = v_gas.id
                RETURNING * INTO v_gas;
            ELSIF v_gas.nonce IS NOT NULL
                  AND nullif(pg_catalog.btrim(coalesce(v_gas.funding_wallet_address, '')), '') IS NOT NULL THEN
                -- A nonce was reserved, but no signed bytes/hash were persisted.
                -- The worker's persist-before-broadcast invariant proves nothing
                -- was broadcast. Re-sign using this exact nonce and immutable amount.
                IF v_gas.amount_allocated IS DISTINCT FROM p_amount_allocated THEN
                    RAISE EXCEPTION 'Gas-funding amount is immutable after nonce allocation'
                        USING ERRCODE = '23514';
                END IF;
                UPDATE public.gas_funding_operations
                SET status = 'PENDING',
                    worker_id = p_worker_id,
                    error_message = NULL,
                    updated_at = pg_catalog.clock_timestamp()
                WHERE id = v_gas.id
                RETURNING * INTO v_gas;
            ELSE
                RAISE EXCEPTION 'Gas-funding recovery row has an inconsistent nonce/wallet reservation; manual reconciliation is required'
                    USING ERRCODE = '23514';
            END IF;
        END IF;

        IF v_gas.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
            IF nullif(pg_catalog.btrim(coalesce(v_gas.tx_hash, '')), '') IS NULL
               OR nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL THEN
                RAISE EXCEPTION 'Persisted gas-funding transaction is incomplete; reconciliation required before another funding attempt';
            END IF;
            UPDATE public.gas_funding_operations
            SET worker_id = p_worker_id,
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_gas.id
            RETURNING * INTO v_gas;
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'already_funded', false,
                'needs_reconciliation', true,
                'status', v_gas.status,
                'tx_hash', v_gas.tx_hash,
                'signed_tx_hex', v_gas.signed_tx_hex,
                'nonce', v_gas.nonce,
                'amount_allocated', v_gas.amount_allocated
            );
        END IF;

        IF v_gas.status <> 'PENDING' THEN
            RAISE EXCEPTION 'Gas-funding operation is in non-retryable state %', v_gas.status
                USING ERRCODE = '55000';
        END IF;

        -- Once a nonce exists, the transfer value is part of the reservation
        -- and cannot be changed between crash recovery and signing.
        IF v_gas.nonce IS NOT NULL
           AND v_gas.amount_allocated IS DISTINCT FROM p_amount_allocated THEN
            RAISE EXCEPTION 'Gas-funding amount is immutable after nonce allocation'
                USING ERRCODE = '23514';
        END IF;

        UPDATE public.gas_funding_operations
        SET amount_allocated = CASE
                WHEN nonce IS NULL THEN p_amount_allocated
                ELSE amount_allocated
            END,
            worker_id = p_worker_id,
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_gas.id
        RETURNING * INTO v_gas;
    ELSE
        INSERT INTO public.gas_funding_operations (
            sweep_id, deposit_address, network, amount_allocated,
            status, worker_id, created_at, updated_at
        )
        VALUES (
            p_sweep_id, p_deposit_address, v_network, p_amount_allocated,
            'PENDING', p_worker_id, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
        )
        RETURNING * INTO v_gas;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'already_funded', false,
        'status', v_gas.status,
        'tx_hash', v_gas.tx_hash,
        'signed_tx_hex', v_gas.signed_tx_hex,
        'nonce', v_gas.nonce,
        'amount_allocated', v_gas.amount_allocated
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_gas_funding_operation(UUID, TEXT, TEXT, NUMERIC, TEXT)
    TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.persist_signed_gas_funding(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_signed_tx_hex TEXT,
    p_tx_hash TEXT,
    p_nonce BIGINT DEFAULT NULL,
    p_funding_tx_fee NUMERIC DEFAULT NULL,
    p_child_sweep_fee NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_hash TEXT := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to persist signed gas-funding transactions'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR p_signed_tx_hex IS NULL OR length(pg_catalog.btrim(p_signed_tx_hex)) < 10
       OR length(p_signed_tx_hex) > 1000000
       OR v_hash !~ '^0x[0-9a-f]{64}$'
       OR p_nonce IS NULL OR p_nonce < 0
       OR (p_funding_tx_fee IS NOT NULL AND p_funding_tx_fee < 0)
       OR (p_child_sweep_fee IS NOT NULL AND p_child_sweep_fee < 0) THEN
        RAISE EXCEPTION 'Invalid signed gas-funding transaction payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
       OR upper(coalesce(v_sweep.status, '')) <> 'GAS_FUNDING' THEN
        RAISE EXCEPTION 'Worker does not own an active GAS_FUNDING sweep lease'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND OR v_gas.worker_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Worker-owned gas-funding claim is required before signing'
            USING ERRCODE = '42501';
    END IF;

    IF v_gas.nonce IS DISTINCT FROM p_nonce
       OR nullif(v_gas.funding_wallet_address, '') IS NULL THEN
        RAISE EXCEPTION 'Signed gas-funding transaction nonce does not match its durable hot-wallet reservation'
            USING ERRCODE = '23514';
    END IF;

    IF v_gas.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
        IF lower(coalesce(v_gas.tx_hash, '')) = v_hash
           AND v_gas.signed_tx_hex = pg_catalog.btrim(p_signed_tx_hex) THEN
            RETURN pg_catalog.jsonb_build_object(
                'success', true, 'idempotent', true,
                'status', v_gas.status, 'tx_hash', v_hash, 'nonce', v_gas.nonce
            );
        END IF;
        RAISE EXCEPTION 'A different signed gas-funding transaction is already persisted; refusing replacement'
            USING ERRCODE = '23505';
    END IF;

    IF v_gas.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Gas-funding operation cannot persist a transaction from state %', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    UPDATE public.gas_funding_operations
    SET signed_tx_hex = pg_catalog.btrim(p_signed_tx_hex),
        tx_hash = v_hash,
        funding_tx_fee = coalesce(p_funding_tx_fee, funding_tx_fee),
        child_sweep_fee = coalesce(p_child_sweep_fee, child_sweep_fee),
        status = 'READY_TO_BROADCAST',
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_gas.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'idempotent', false,
        'status', 'READY_TO_BROADCAST', 'tx_hash', v_hash, 'nonce', v_gas.nonce
    );
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_gas_funding_nonce(UUID, TEXT, TEXT, TEXT, BIGINT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.allocate_gas_funding_nonce(UUID, TEXT, TEXT, TEXT, BIGINT)
    TO service_role, postgres;

REVOKE ALL ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, NUMERIC)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT, BIGINT, NUMERIC, NUMERIC)
    TO service_role, postgres;

COMMENT ON FUNCTION public.allocate_gas_funding_nonce(UUID, TEXT, TEXT, TEXT, BIGINT) IS
    'Service-only idempotent EVM hot-wallet nonce reservation bound to one active gas-funding operation.';

COMMIT;
