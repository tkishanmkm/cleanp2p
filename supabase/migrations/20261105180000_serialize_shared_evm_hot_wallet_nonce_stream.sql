-- Withdrawals and custodial gas-funding transactions use the same EVM hot-wallet
-- key and per-chain nonce counter. Serialize both operation classes through the
-- same hot_wallet_nonces row and block a new allocation while either class owns
-- an unresolved nonce. Deposit-address sweeps remain on their own per-address
-- nonce registry because they are signed by deposit-address keys.
BEGIN;

CREATE INDEX IF NOT EXISTS idx_withdrawal_nonce_reservations_unresolved_hot_wallet
    ON public.onchain_withdrawal_nonce_reservations
       (upper(network), lower(wallet_address), nonce)
    WHERE status NOT IN ('CONFIRMED', 'FAILED', 'RELEASED');

-- Add the withdrawal-reservation check to the existing gas-funding allocator.
-- Its current shared hot_wallet_nonces row lock is the serialization point.
DO $migration$
DECLARE
    v_definition text;
    v_marker text := '    -- This check is deliberately performed AFTER locking the chain nonce row.';
    v_marker_position integer;
    v_insert text := $insert$
    -- A withdrawal nonce may be the predecessor of this gas-funding transaction.
    -- Do not allocate the next shared hot-wallet nonce until that exact withdrawal
    -- has a terminal, chain-proven result.
    IF EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_nonce_reservations AS prior
        WHERE upper(prior.network) = v_network
          AND lower(prior.wallet_address) = v_wallet
          AND prior.nonce IS NOT NULL
          AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED', 'RELEASED')
    ) THEN
        RAISE EXCEPTION 'An earlier withdrawal nonce for this hot wallet is unresolved; reconcile it before gas-funding allocation'
            USING ERRCODE = '55P03';
    END IF;

$insert$;
BEGIN
    SELECT pg_catalog.pg_get_functiondef(
        'public.allocate_gas_funding_nonce(uuid,text,text,text,bigint)'::regprocedure
    )
    INTO v_definition;

    v_marker_position := pg_catalog.strpos(v_definition, v_marker);
    IF v_marker_position = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, v_marker_position + pg_catalog.length(v_marker)),
            v_marker
          ) <> 0 THEN
        RAISE EXCEPTION 'Could not locate one unique shared nonce-lock marker in allocate_gas_funding_nonce';
    END IF;

    v_definition := pg_catalog.replace(v_definition, v_marker, v_insert || v_marker);

    -- Legacy gas-funding rows created before funding_wallet_address was added
    -- cannot be proven to belong to another key. Fail closed and treat a
    -- nonce-bearing NULL wallet as belonging to this single configured hot wallet.
    IF pg_catalog.strpos(v_definition, $old$AND lower(coalesce(prior.funding_wallet_address, '')) = v_wallet$old$) = 0 THEN
        RAISE EXCEPTION 'Could not locate gas-funding wallet filter for legacy-safe serialization';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        $old$AND lower(coalesce(prior.funding_wallet_address, '')) = v_wallet$old$,
        $new$AND (prior.funding_wallet_address IS NULL OR lower(coalesce(prior.funding_wallet_address, '')) = v_wallet)$new$
    );

    -- A nonce with no signed payload may be re-signed only while chain pending
    -- has not advanced past it. If bytes/hash exist, this fresh allocator must
    -- not sign a replacement; the exact persisted transaction recovery path owns it.
    IF pg_catalog.strpos(v_definition, $old$        RETURN v_gas.nonce;$old$) = 0 THEN
        RAISE EXCEPTION 'Could not locate existing gas-funding nonce retry return';
    END IF;
    v_definition := pg_catalog.replace(
        v_definition,
        $old$        RETURN v_gas.nonce;$old$,
        $new$        IF EXISTS (
            SELECT 1
            FROM public.onchain_withdrawal_nonce_reservations AS prior
            WHERE upper(prior.network) = v_network
              AND lower(prior.wallet_address) = v_wallet
              AND prior.nonce < v_gas.nonce
              AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED', 'RELEASED')
        ) OR EXISTS (
            SELECT 1
            FROM public.gas_funding_operations AS prior
            WHERE prior.sweep_id <> p_sweep_id
              AND prior.network = v_network
              AND (prior.funding_wallet_address IS NULL OR lower(coalesce(prior.funding_wallet_address, '')) = v_wallet)
              AND prior.nonce < v_gas.nonce
              AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
        ) THEN
            RAISE EXCEPTION 'An earlier shared hot-wallet nonce is unresolved; retry this gas-funding operation after it is reconciled'
                USING ERRCODE = '55P03';
        END IF;
        IF nullif(pg_catalog.btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NOT NULL
           OR nullif(pg_catalog.btrim(coalesce(v_gas.tx_hash, '')), '') IS NOT NULL THEN
            RAISE EXCEPTION 'Persisted gas-funding transaction must use exact-byte recovery, not fresh nonce allocation'
                USING ERRCODE = '55000';
        END IF;
        IF p_onchain_pending_nonce > v_gas.nonce THEN
            RAISE EXCEPTION 'Reserved gas-funding nonce is already consumed on-chain; automatic re-signing is prohibited'
                USING ERRCODE = '55000';
        END IF;
        RETURN v_gas.nonce;$new$
    );
    EXECUTE v_definition;
END;
$migration$;

-- Withdrawal nonce allocation now participates in exactly the same chain-level
-- serialization point as gas funding. This also makes first-row initialization
-- race-safe; the prior helper attempted a plain INSERT if the row was absent.
CREATE OR REPLACE FUNCTION public.allocate_onchain_withdrawal_nonce(
    p_withdrawal_id uuid,
    p_worker_id text,
    p_network text,
    p_wallet_address text,
    p_onchain_pending_nonce bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_withdrawal public.onchain_withdrawals%ROWTYPE;
    v_reservation public.onchain_withdrawal_nonce_reservations%ROWTYPE;
    v_network text := upper(pg_catalog.btrim(coalesce(p_network, '')));
    v_chain_id integer;
    v_wallet text := lower(pg_catalog.btrim(coalesce(p_wallet_address, '')));
    v_current_nonce bigint;
    v_nonce bigint;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required to reserve withdrawal nonces'
            USING ERRCODE = '42501';
    END IF;

    IF p_withdrawal_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR v_network NOT IN ('ERC20', 'BEP20')
       OR v_wallet !~ '^0x[0-9a-f]{40}$'
       OR p_onchain_pending_nonce IS NULL
       OR p_onchain_pending_nonce < 0 THEN
        RAISE EXCEPTION 'Invalid on-chain withdrawal nonce reservation payload'
            USING ERRCODE = '22023';
    END IF;

    v_chain_id := CASE WHEN v_network = 'ERC20' THEN 1 ELSE 56 END;

    SELECT *
      INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_withdrawal.worker_id IS DISTINCT FROM p_worker_id
       OR v_withdrawal.lease_expires_at IS NULL
       OR v_withdrawal.lease_expires_at <= pg_catalog.clock_timestamp()
       OR upper(v_withdrawal.network) IS DISTINCT FROM v_network
       OR upper(v_withdrawal.status) <> 'PROCESSING' THEN
        RAISE EXCEPTION 'Active PROCESSING withdrawal lease is required for nonce reservation'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_reservation
    FROM public.onchain_withdrawal_nonce_reservations
    WHERE withdrawal_id = p_withdrawal_id
    FOR UPDATE;

    IF FOUND THEN
        IF upper(v_reservation.network) IS DISTINCT FROM v_network
           OR lower(v_reservation.wallet_address) IS DISTINCT FROM v_wallet THEN
            RAISE EXCEPTION 'Existing withdrawal nonce reservation does not match the network/hot wallet'
                USING ERRCODE = '23514';
        END IF;

        IF v_reservation.status <> 'RESERVED' THEN
            RAISE EXCEPTION 'Nonce reservation is no longer unsigned; exact durable transaction recovery is required'
                USING ERRCODE = '55000';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.onchain_withdrawal_broadcasts b
            WHERE b.withdrawal_id = p_withdrawal_id
        ) THEN
            RAISE EXCEPTION 'A durable broadcast record already exists; replacement signing is prohibited'
                USING ERRCODE = '55000';
        END IF;

        IF p_onchain_pending_nonce > v_reservation.nonce THEN
            RAISE EXCEPTION 'Reserved nonce is already consumed on-chain; automatic re-signing is prohibited'
                USING ERRCODE = '55000';
        END IF;

        -- An idempotent retry may reuse its RESERVED nonce only after all lower
        -- nonces across both hot-wallet operation classes have been reconciled.
        IF EXISTS (
            SELECT 1
            FROM public.gas_funding_operations AS prior
            WHERE prior.network = v_network
              AND (prior.funding_wallet_address IS NULL OR lower(coalesce(prior.funding_wallet_address, '')) = v_wallet)
              AND prior.nonce < v_reservation.nonce
              AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
        ) OR EXISTS (
            SELECT 1
            FROM public.onchain_withdrawal_nonce_reservations AS prior
            WHERE prior.withdrawal_id <> p_withdrawal_id
              AND upper(prior.network) = v_network
              AND lower(prior.wallet_address) = v_wallet
              AND prior.nonce < v_reservation.nonce
              AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED', 'RELEASED')
        ) THEN
            RAISE EXCEPTION 'An earlier shared hot-wallet nonce is unresolved; retry this withdrawal after it is reconciled'
                USING ERRCODE = '55P03';
        END IF;
        RETURN v_reservation.nonce;
    END IF;

    -- Race-safe row initialization followed by the common chain-level lock.
    INSERT INTO public.hot_wallet_nonces (chain_id, current_nonce, updated_at)
    VALUES (v_chain_id, p_onchain_pending_nonce, pg_catalog.clock_timestamp())
    ON CONFLICT (chain_id) DO NOTHING;

    SELECT current_nonce
      INTO v_current_nonce
    FROM public.hot_wallet_nonces
    WHERE chain_id = v_chain_id
    FOR UPDATE;

    IF v_current_nonce IS NULL
       OR v_current_nonce < 0
       OR v_current_nonce >= 2147483647 THEN
        RAISE EXCEPTION 'Hot-wallet nonce registry is outside the supported withdrawal nonce range'
            USING ERRCODE = '22003';
    END IF;

    -- Cross-stream gate: gas funding and withdrawals consume the same EVM
    -- hot-wallet nonce sequence. A lock-protected check prevents either worker
    -- from allocating N+1 while the other owns an unresolved N.
    IF EXISTS (
        SELECT 1
        FROM public.gas_funding_operations AS prior
        WHERE prior.network = v_network
          AND (prior.funding_wallet_address IS NULL OR lower(coalesce(prior.funding_wallet_address, '')) = v_wallet)
          AND prior.nonce IS NOT NULL
          AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED')
    ) THEN
        RAISE EXCEPTION 'An earlier gas-funding nonce for this hot wallet is unresolved; reconcile it before withdrawal allocation'
            USING ERRCODE = '55P03';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.onchain_withdrawal_nonce_reservations AS prior
        WHERE prior.withdrawal_id <> p_withdrawal_id
          AND upper(prior.network) = v_network
          AND lower(prior.wallet_address) = v_wallet
          AND prior.nonce IS NOT NULL
          AND upper(coalesce(prior.status, '')) NOT IN ('CONFIRMED', 'FAILED', 'RELEASED')
    ) THEN
        RAISE EXCEPTION 'An earlier withdrawal nonce for this hot wallet is unresolved; reconcile it before allocating another'
            USING ERRCODE = '55P03';
    END IF;

    v_nonce := GREATEST(v_current_nonce, p_onchain_pending_nonce);
    IF v_nonce < 0 OR v_nonce > 2147483646 THEN
        RAISE EXCEPTION 'Allocated withdrawal nonce is outside the supported integer range'
            USING ERRCODE = '22003';
    END IF;

    UPDATE public.hot_wallet_nonces
    SET current_nonce = v_nonce + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE chain_id = v_chain_id;

    INSERT INTO public.onchain_withdrawal_nonce_reservations (
        withdrawal_id, network, wallet_address, nonce, status
    )
    VALUES (
        p_withdrawal_id, v_network, v_wallet, v_nonce, 'RESERVED'
    );

    RETURN v_nonce;
END;
$function$;

-- Retire direct hot-wallet counter allocation. No application code calls these
-- helpers; only the operation-bound gas-funding and withdrawal RPCs may advance
-- the shared counter. SECURITY DEFINER owners retain internal execution rights.
REVOKE ALL ON FUNCTION public.allocate_hot_wallet_nonce(text,text,bigint)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.allocate_hot_wallet_nonce(integer)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(text,text,bigint)
    TO postgres;
GRANT EXECUTE ON FUNCTION public.allocate_hot_wallet_nonce(integer)
    TO postgres;

REVOKE ALL ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
    TO service_role, postgres;

COMMENT ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint) IS
    'Service-only withdrawal nonce reservation serialized with custodial gas funding through the shared per-chain EVM hot-wallet nonce row.';

COMMIT;
