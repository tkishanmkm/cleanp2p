-- Require canonical confirmation depth before EVM gas-funding receipts can release a shared hot-wallet nonce.
BEGIN;

-- Retire the pre-finality RPC signature so callers cannot bypass p_confirmations.
DROP FUNCTION IF EXISTS public.record_evm_gas_funding_receipt(UUID, TEXT, TEXT, SMALLINT, NUMERIC, NUMERIC, BIGINT, TEXT);

ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS actual_funding_tx_gas_used NUMERIC(78,0),
    ADD COLUMN IF NOT EXISTS actual_funding_tx_effective_gas_price NUMERIC(78,0),
    ADD COLUMN IF NOT EXISTS actual_funding_tx_fee NUMERIC(36,18),
    ADD COLUMN IF NOT EXISTS funding_receipt_status SMALLINT,
    ADD COLUMN IF NOT EXISTS funding_receipt_block_number BIGINT,
    ADD COLUMN IF NOT EXISTS funding_receipt_block_hash TEXT,
    ADD COLUMN IF NOT EXISTS funding_receipt_confirmations INTEGER;

-- Prevent any legacy status RPC or accidental direct update from marking an
-- EVM gas-funding record CONFIRMED without a successful, fee-accounted receipt.
ALTER TABLE public.gas_funding_operations
    DROP CONSTRAINT IF EXISTS gas_funding_evm_confirmed_requires_receipt;
ALTER TABLE public.gas_funding_operations
    ADD CONSTRAINT gas_funding_evm_confirmed_requires_receipt
    CHECK (
        upper(network) NOT IN ('ERC20', 'BEP20')
        OR status <> 'CONFIRMED'
        OR (
            funding_receipt_status = 1
            AND actual_funding_tx_gas_used IS NOT NULL
            AND actual_funding_tx_effective_gas_price IS NOT NULL
            AND actual_funding_tx_fee IS NOT NULL
            AND funding_receipt_block_number IS NOT NULL
            AND funding_receipt_block_hash IS NOT NULL
            AND funding_receipt_confirmations IS NOT NULL
            AND funding_receipt_confirmations >= CASE
                WHEN upper(network) = 'ERC20' THEN 12
                WHEN upper(network) = 'BEP20' THEN 15
                ELSE 2147483647
            END
        )
    );

-- An allocated EVM nonce cannot be abandoned as FAILED unless a mined reverted
-- receipt proves that the nonce was consumed. Otherwise later transactions from
-- the same hot wallet would remain blocked behind a permanent nonce gap.
ALTER TABLE public.gas_funding_operations
    DROP CONSTRAINT IF EXISTS gas_funding_failed_nonce_requires_consumed_receipt;
ALTER TABLE public.gas_funding_operations
    ADD CONSTRAINT gas_funding_failed_nonce_requires_consumed_receipt
    CHECK (
        upper(network) NOT IN ('ERC20', 'BEP20')
        OR status <> 'FAILED'
        OR nonce IS NULL
        OR (
            funding_receipt_status = 0
            AND funding_receipt_confirmations IS NOT NULL
            AND funding_receipt_confirmations >= CASE
                WHEN upper(network) = 'ERC20' THEN 12
                WHEN upper(network) = 'BEP20' THEN 15
                ELSE 2147483647
            END
        )
    );

CREATE OR REPLACE FUNCTION public.record_evm_gas_funding_receipt(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_tx_hash TEXT,
    p_receipt_status SMALLINT,
    p_confirmations INTEGER,
    p_gas_used NUMERIC,
    p_effective_gas_price NUMERIC,
    p_block_number BIGINT,
    p_block_hash TEXT
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
    v_block_hash TEXT := lower(pg_catalog.btrim(coalesce(p_block_hash, '')));
    v_actual_fee NUMERIC(36,18);
    v_next_status TEXT;
    v_required_confirmations INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to record EVM gas-funding receipts'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR v_hash !~ '^0x[0-9a-f]{64}$'
       OR p_receipt_status IS NULL OR p_receipt_status NOT IN (0, 1)
       OR p_confirmations IS NULL OR p_confirmations < 1
       OR p_gas_used IS NULL OR p_gas_used <= 0 OR pg_catalog.trunc(p_gas_used) <> p_gas_used
       OR p_effective_gas_price IS NULL OR p_effective_gas_price <= 0 OR pg_catalog.trunc(p_effective_gas_price) <> p_effective_gas_price
       OR p_block_number IS NULL OR p_block_number < 0
       OR v_block_hash !~ '^0x[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Invalid EVM gas-funding receipt payload'
            USING ERRCODE = '22023';
    END IF;

    v_actual_fee := (p_gas_used * p_effective_gas_price) / 1000000000000000000::numeric;
    v_next_status := CASE WHEN p_receipt_status = 1 THEN 'CONFIRMED' ELSE 'RECOVERY_REQUIRED' END;

    SELECT *
      INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
       OR upper(coalesce(v_sweep.status, '')) NOT IN ('GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Active GAS_FUNDING or GAS_FUNDED sweep lease is required to record its gas receipt'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_gas.worker_id IS DISTINCT FROM p_worker_id
       OR lower(coalesce(v_gas.tx_hash, '')) IS DISTINCT FROM v_hash
       OR nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL
       OR upper(coalesce(v_gas.network, '')) NOT IN ('ERC20', 'BEP20') THEN
        RAISE EXCEPTION 'Gas-funding receipt does not match a persisted worker-owned EVM transaction'
            USING ERRCODE = '23514';
    END IF;

    v_required_confirmations := CASE WHEN upper(v_gas.network) = 'ERC20' THEN 12 ELSE 15 END;
    IF p_confirmations < v_required_confirmations THEN
        RAISE EXCEPTION 'EVM gas-funding receipt is below the required canonical confirmation depth'
            USING ERRCODE = '23514';
    END IF;

    IF v_gas.funding_receipt_status IS NOT NULL THEN
        IF v_gas.funding_receipt_status IS DISTINCT FROM p_receipt_status
           OR v_gas.actual_funding_tx_gas_used IS DISTINCT FROM p_gas_used
           OR v_gas.actual_funding_tx_effective_gas_price IS DISTINCT FROM p_effective_gas_price
           OR v_gas.funding_receipt_block_number IS DISTINCT FROM p_block_number
           OR lower(coalesce(v_gas.funding_receipt_block_hash, '')) IS DISTINCT FROM v_block_hash THEN
            IF upper(coalesce(v_gas.status, '')) <> 'RECOVERY_REQUIRED' THEN
                RAISE EXCEPTION 'A different receipt is already recorded; receipt refresh requires a prior canonicality-loss recovery lock'
                    USING ERRCODE = '23505';
            END IF;

            -- The worker revalidated the same signed transaction against the
            -- current canonical chain after a prior receipt was marked unverified.
            -- Refresh actual fee and block identity only from this recovery state.
            UPDATE public.gas_funding_operations
            SET status = v_next_status,
                funding_receipt_status = p_receipt_status,
                actual_funding_tx_gas_used = p_gas_used,
                actual_funding_tx_effective_gas_price = p_effective_gas_price,
                actual_funding_tx_fee = v_actual_fee,
                funding_receipt_block_number = p_block_number,
                funding_receipt_block_hash = v_block_hash,
                funding_receipt_confirmations = p_confirmations,
                worker_id = p_worker_id,
                error_message = CASE
                    WHEN p_receipt_status = 0 THEN
                        'EVM gas-funding transaction was re-included but reverted; refreshed actual network fee recorded.'
                    ELSE NULL
                END,
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_gas.id;

            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', false,
                'receipt_refreshed_after_reorg', true,
                'status', v_next_status,
                'actual_funding_tx_fee', v_actual_fee,
                'tx_hash', v_hash,
                'block_number', p_block_number
            );
        END IF;

        IF upper(coalesce(v_gas.status, '')) = 'RECOVERY_REQUIRED'
           AND p_receipt_status = 1 THEN
            -- Same receipt is canonical again after a transient chain-view loss.
            UPDATE public.gas_funding_operations
            SET status = 'CONFIRMED',
                funding_receipt_confirmations = greatest(
                    coalesce(v_gas.funding_receipt_confirmations, 0),
                    p_confirmations
                ),
                worker_id = p_worker_id,
                error_message = NULL,
                updated_at = pg_catalog.clock_timestamp()
            WHERE id = v_gas.id;
            RETURN pg_catalog.jsonb_build_object(
                'success', true,
                'idempotent', true,
                'status', 'CONFIRMED',
                'actual_funding_tx_fee', v_gas.actual_funding_tx_fee,
                'tx_hash', v_hash
            );
        END IF;

        UPDATE public.gas_funding_operations
        SET funding_receipt_confirmations = greatest(
                coalesce(funding_receipt_confirmations, 0),
                p_confirmations
            ),
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = v_gas.id;

        RETURN pg_catalog.jsonb_build_object(
            'success', true,
            'idempotent', true,
            'status', v_gas.status,
            'actual_funding_tx_fee', v_gas.actual_funding_tx_fee,
            'confirmations', greatest(coalesce(v_gas.funding_receipt_confirmations, 0), p_confirmations),
            'tx_hash', v_hash
        );
    END IF;

    IF upper(coalesce(v_gas.status, '')) NOT IN (
        'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED'
    ) THEN
        RAISE EXCEPTION 'Cannot attach an on-chain receipt to gas-funding state %', v_gas.status
            USING ERRCODE = '55000';
    END IF;

    UPDATE public.gas_funding_operations
    SET status = v_next_status,
        funding_receipt_status = p_receipt_status,
        actual_funding_tx_gas_used = p_gas_used,
        actual_funding_tx_effective_gas_price = p_effective_gas_price,
        actual_funding_tx_fee = v_actual_fee,
        funding_receipt_block_number = p_block_number,
        funding_receipt_block_hash = v_block_hash,
        funding_receipt_confirmations = p_confirmations,
        worker_id = p_worker_id,
        error_message = CASE
            WHEN p_receipt_status = 0 THEN
                'EVM gas-funding transaction was mined but reverted; actual network fee recorded.'
            ELSE error_message
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_gas.id;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'idempotent', false,
        'status', v_next_status,
        'actual_funding_tx_fee', v_actual_fee,
        'tx_hash', v_hash,
        'block_number', p_block_number
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_evm_gas_funding_receipt(UUID, TEXT, TEXT, SMALLINT, INTEGER, NUMERIC, NUMERIC, BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_evm_gas_funding_receipt(UUID, TEXT, TEXT, SMALLINT, INTEGER, NUMERIC, NUMERIC, BIGINT, TEXT)
    TO service_role, postgres;

COMMENT ON COLUMN public.gas_funding_operations.funding_receipt_confirmations IS
    'Canonical block confirmations independently checked by the worker before receipt evidence can settle the shared hot-wallet nonce.';

COMMENT ON COLUMN public.gas_funding_operations.actual_funding_tx_fee IS
    'Actual EVM network fee paid, in native ETH/BNB units, derived from receipt gasUsed * effectiveGasPrice.';
COMMENT ON COLUMN public.gas_funding_operations.funding_tx_fee IS
    'Pre-broadcast gas-funding fee estimate/reserve; actual receipt fee is stored separately.';


-- If a previously final EVM gas-funding receipt disappears or is no longer
-- canonical, put the operation back into RECOVERY_REQUIRED so the global hot
-- wallet nonce allocator will not advance past a possibly unconsumed nonce.
CREATE OR REPLACE FUNCTION public.mark_evm_gas_funding_receipt_recovery_required(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_tx_hash TEXT,
    p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_gas public.gas_funding_operations%ROWTYPE;
    v_hash TEXT := pg_catalog.lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to mark EVM gas receipt recovery'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR v_hash !~ '^0x[0-9a-f]{64}$'
       OR (p_error_message IS NOT NULL AND pg_catalog.length(p_error_message) > 1000) THEN
        RAISE EXCEPTION 'Invalid EVM gas receipt recovery request'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
       OR pg_catalog.upper(coalesce(v_sweep.status, '')) NOT IN ('GAS_FUNDING', 'GAS_FUNDED') THEN
        RAISE EXCEPTION 'Active GAS_FUNDING or GAS_FUNDED parent lease is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_gas.worker_id IS DISTINCT FROM p_worker_id
       OR pg_catalog.lower(coalesce(v_gas.tx_hash, '')) IS DISTINCT FROM v_hash
       OR nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL
       OR pg_catalog.upper(coalesce(v_gas.status, '')) <> 'CONFIRMED'
       OR v_gas.funding_receipt_status IS DISTINCT FROM 1
       OR v_gas.funding_receipt_confirmations IS NULL
       OR (upper(v_gas.network) = 'ERC20' AND v_gas.funding_receipt_confirmations < 12)
       OR (upper(v_gas.network) = 'BEP20' AND v_gas.funding_receipt_confirmations < 15)
       OR v_gas.funding_receipt_block_number IS NULL
       OR nullif(pg_catalog.btrim(coalesce(v_gas.funding_receipt_block_hash, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Only a receipt-backed CONFIRMED gas-funding transaction can be moved into reorg recovery'
            USING ERRCODE = '23514';
    END IF;

    UPDATE public.gas_funding_operations
    SET status = 'RECOVERY_REQUIRED',
        error_message = left(
          coalesce(p_error_message, 'Previously confirmed gas-funding receipt is no longer canonical; nonce remains reserved.'),
          1000
        ),
        worker_id = p_worker_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_gas.id;

    RETURN pg_catalog.jsonb_build_object(
      'success', true,
      'status', 'RECOVERY_REQUIRED',
      'tx_hash', v_hash,
      'nonce', v_gas.nonce
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_evm_gas_funding_receipt_recovery_required(UUID, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.mark_evm_gas_funding_receipt_recovery_required(UUID, TEXT, TEXT, TEXT)
    TO service_role, postgres;

COMMIT;
