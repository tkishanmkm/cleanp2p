-- Bind the exact intended EVM sweep transfer to the immutable signed transaction.
-- Recovery can then verify chain, asset, contract, recipient and raw amount after a crash.

BEGIN;

ALTER TABLE public.sweep_operations
    ADD COLUMN IF NOT EXISTS signed_asset_code TEXT,
    ADD COLUMN IF NOT EXISTS signed_token_contract TEXT,
    ADD COLUMN IF NOT EXISTS signed_recipient TEXT,
    ADD COLUMN IF NOT EXISTS signed_amount_raw NUMERIC(78, 0),
    ADD COLUMN IF NOT EXISTS signed_chain_id BIGINT;

-- Legacy signed rows may predate these intent columns. Do not add a CHECK
-- that would prevent their status-only recovery updates; recovery fails closed
-- for those rows until manually reconciled. New intent is enforced by the RPC.

CREATE OR REPLACE FUNCTION public.prevent_signed_sweep_intent_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF (OLD.signed_tx_hex IS NOT NULL OR OLD.sweep_tx_hash IS NOT NULL) AND (
        NEW.signed_tx_hex IS DISTINCT FROM OLD.signed_tx_hex
        OR NEW.sweep_tx_hash IS DISTINCT FROM OLD.sweep_tx_hash
        OR NEW.signed_asset_code IS DISTINCT FROM OLD.signed_asset_code
        OR NEW.signed_token_contract IS DISTINCT FROM OLD.signed_token_contract
        OR NEW.signed_recipient IS DISTINCT FROM OLD.signed_recipient
        OR NEW.signed_amount_raw IS DISTINCT FROM OLD.signed_amount_raw
        OR NEW.signed_chain_id IS DISTINCT FROM OLD.signed_chain_id
    ) THEN
        RAISE EXCEPTION 'Persisted signed sweep payload and intent are immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_signed_sweep_intent_mutation
    ON public.sweep_operations;
CREATE TRIGGER trg_prevent_signed_sweep_intent_mutation
    BEFORE UPDATE ON public.sweep_operations
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_signed_sweep_intent_mutation();

REVOKE ALL ON FUNCTION public.prevent_signed_sweep_intent_mutation()
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.prevent_signed_sweep_intent_mutation()
    TO postgres;

DROP FUNCTION IF EXISTS public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER);

CREATE FUNCTION public.persist_signed_evm_transaction(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_nonce BIGINT,
    p_signed_tx_hex TEXT,
    p_sweep_tx_hash TEXT,
    p_asset_code TEXT,
    p_token_contract TEXT,
    p_recipient TEXT,
    p_amount_raw NUMERIC,
    p_chain_id BIGINT,
    p_extend_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sweep public.sweep_operations%ROWTYPE;
    v_new_lease TIMESTAMPTZ;
    v_net_code TEXT;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR p_expected_status IS NULL
       OR pg_catalog.upper(pg_catalog.btrim(p_expected_status)) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
       OR p_nonce IS NULL OR p_nonce < 0
       OR p_signed_tx_hex IS NULL OR p_signed_tx_hex !~ '^0x([0-9a-fA-F]{2})+$'
       OR p_sweep_tx_hash IS NULL OR p_sweep_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
       OR p_asset_code IS NULL OR p_asset_code NOT IN ('ETH', 'USDT')
       OR p_recipient IS NULL OR p_recipient !~* '^0x[0-9a-f]{40}$'
       OR p_amount_raw IS NULL OR p_amount_raw <= 0 OR p_amount_raw <> pg_catalog.trunc(p_amount_raw)
       OR p_chain_id IS NULL OR p_chain_id NOT IN (1, 56)
       OR (p_asset_code = 'ETH' AND (p_token_contract IS NOT NULL OR p_chain_id <> 1))
       OR (p_asset_code = 'USDT' AND (p_token_contract IS NULL OR p_token_contract !~* '^0x[0-9a-f]{40}$'))
       OR (p_asset_code = 'USDT' AND (
            (p_chain_id = 1 AND pg_catalog.lower(p_token_contract) <> '0xdac17f958d2ee523a2206206994597c13d831ec7')
            OR
            (p_chain_id = 56 AND pg_catalog.lower(p_token_contract) <> '0x55d398326f99059ff775485246999027b3197955')
       ))
       OR p_extend_lease_seconds IS NULL OR p_extend_lease_seconds < 30 OR p_extend_lease_seconds > 900 THEN
        RAISE EXCEPTION 'Invalid signed EVM sweep intent or persistence payload'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
       OR v_sweep.lease_expires_at IS NULL
       OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'ACTIVE_LEASE_REQUIRED');
    END IF;

    IF pg_catalog.upper(COALESCE(v_sweep.status, '')) <>
       pg_catalog.upper(pg_catalog.btrim(p_expected_status)) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'STATE_MISMATCH');
    END IF;

    v_net_code := pg_catalog.upper(pg_catalog.btrim(COALESCE(v_sweep.network, '')));
    IF v_net_code NOT IN ('ETHEREUM', 'ERC20', 'ETH', 'BSC', 'BEP20', 'BINANCE') THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK');
    END IF;

    IF (p_chain_id = 1 AND v_net_code NOT IN ('ETHEREUM', 'ERC20', 'ETH'))
       OR (p_chain_id = 56 AND v_net_code NOT IN ('BSC', 'BEP20', 'BINANCE')) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'CHAIN_NETWORK_MISMATCH');
    END IF;

    IF v_sweep.nonce IS NULL OR v_sweep.nonce <> p_nonce THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'NONCE_RESERVATION_MISMATCH');
    END IF;

    IF v_sweep.signed_tx_hex IS NOT NULL
       AND v_sweep.signed_tx_hex <> pg_catalog.btrim(p_signed_tx_hex) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SIGNED_TX_MUTATION_REJECTED');
    END IF;
    IF v_sweep.sweep_tx_hash IS NOT NULL
       AND pg_catalog.lower(v_sweep.sweep_tx_hash) <> pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'TX_HASH_MUTATION_REJECTED');
    END IF;

    IF v_sweep.signed_asset_code IS NOT NULL
       AND (v_sweep.signed_asset_code <> p_asset_code
         OR COALESCE(pg_catalog.lower(v_sweep.signed_token_contract), '') <> COALESCE(pg_catalog.lower(p_token_contract), '')
         OR pg_catalog.lower(v_sweep.signed_recipient) <> pg_catalog.lower(p_recipient)
         OR v_sweep.signed_amount_raw <> p_amount_raw
         OR v_sweep.signed_chain_id <> p_chain_id) THEN
        RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SIGNED_INTENT_MUTATION_REJECTED');
    END IF;

    v_new_lease := pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_extend_lease_seconds);

    UPDATE public.sweep_operations
    SET status = 'READY_TO_BROADCAST',
        signed_tx_hex = pg_catalog.btrim(p_signed_tx_hex),
        sweep_tx_hash = pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)),
        signed_asset_code = p_asset_code,
        signed_token_contract = CASE WHEN p_token_contract IS NULL THEN NULL ELSE pg_catalog.lower(p_token_contract) END,
        signed_recipient = pg_catalog.lower(p_recipient),
        signed_amount_raw = p_amount_raw,
        signed_chain_id = p_chain_id,
        lease_expires_at = v_new_lease,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND nonce = p_nonce;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Could not persist signed transaction and immutable intent'
            USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true, 'sweep_id', p_sweep_id,
        'status', 'READY_TO_BROADCAST', 'nonce', p_nonce,
        'sweep_tx_hash', pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, BIGINT, INTEGER)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, BIGINT, INTEGER)
    TO service_role, postgres;

COMMIT;
