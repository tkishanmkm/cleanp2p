-- Harden the EVM sweep signed-payload persistence boundary.
-- Requires a nonce already reserved by allocate_deposit_address_nonce.

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_signed_evm_transaction(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_nonce BIGINT,
    p_signed_tx_hex TEXT,
    p_sweep_tx_hash TEXT,
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
        RAISE EXCEPTION 'Service role required to persist signed EVM sweep transactions'
            USING ERRCODE = '42501';
    END IF;

    IF p_sweep_id IS NULL
       OR p_worker_id IS NULL
       OR pg_catalog.btrim(p_worker_id) = ''
       OR pg_catalog.length(p_worker_id) > 128
       OR p_expected_status IS NULL
       OR pg_catalog.upper(pg_catalog.btrim(p_expected_status)) NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED')
       OR p_nonce IS NULL
       OR p_nonce < 0
       OR p_signed_tx_hex IS NULL
       OR p_signed_tx_hex !~ '^0x([0-9a-fA-F]{2})+$'
       OR p_sweep_tx_hash IS NULL
       OR p_sweep_tx_hash !~ '^0x[0-9a-fA-F]{64}$'
       OR p_extend_lease_seconds IS NULL
       OR p_extend_lease_seconds < 30
       OR p_extend_lease_seconds > 900 THEN
        RAISE EXCEPTION 'Invalid signed EVM sweep persistence payload'
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

    v_new_lease := pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => p_extend_lease_seconds);

    UPDATE public.sweep_operations
    SET status = 'READY_TO_BROADCAST',
        signed_tx_hex = pg_catalog.btrim(p_signed_tx_hex),
        sweep_tx_hash = pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)),
        lease_expires_at = v_new_lease,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_sweep_id
      AND worker_id = p_worker_id
      AND nonce = p_nonce;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Could not persist signed transaction against the reserved nonce'
            USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'sweep_id', p_sweep_id,
        'status', 'READY_TO_BROADCAST',
        'nonce', p_nonce,
        'sweep_tx_hash', pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER)
    TO service_role, postgres;

COMMENT ON FUNCTION public.persist_signed_evm_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, INTEGER) IS
    'Service-only EVM sweep persistence. Requires active worker lease and preallocated matching nonce; makes signed bytes and transaction hash immutable before broadcast.';

COMMIT;
