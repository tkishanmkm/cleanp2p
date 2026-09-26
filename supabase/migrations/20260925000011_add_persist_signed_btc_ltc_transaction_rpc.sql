-- ============================================================================
-- Supabase Migration: 20260925000011_add_persist_signed_btc_ltc_transaction_rpc.sql
-- Description: Blocker #5 Fix - Secure atomic signed transaction durability for BTC/LTC
--              1. Adds public.persist_signed_btc_ltc_transaction() to atomically
--                 persist raw signed transaction hex and transition status to
--                 READY_TO_BROADCAST.
--              2. Ensures that once a sweep transaction is constructed and signed,
--                 its exact bytes are secured in sweep_operations.signed_tx_hex
--                 before any broadcast attempt occurs.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_signed_btc_ltc_transaction(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_signed_tx_hex TEXT,
    p_sweep_tx_hash TEXT,
    p_extend_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_new_lease TIMESTAMPTZ := NOW() + (p_extend_lease_seconds || ' seconds')::INTERVAL;
    v_net_code TEXT;
BEGIN
    -- 1. Input validations
    IF p_sweep_id IS NULL THEN
        RAISE EXCEPTION 'p_sweep_id cannot be null';
    END IF;

    IF p_worker_id IS NULL OR TRIM(p_worker_id) = '' THEN
        RAISE EXCEPTION 'p_worker_id cannot be null or empty';
    END IF;

    IF p_expected_status IS NULL OR TRIM(p_expected_status) = '' THEN
        RAISE EXCEPTION 'p_expected_status cannot be null or empty';
    END IF;

    IF p_signed_tx_hex IS NULL OR TRIM(p_signed_tx_hex) = '' THEN
        RAISE EXCEPTION 'p_signed_tx_hex cannot be null or empty';
    END IF;

    IF p_sweep_tx_hash IS NULL OR TRIM(p_sweep_tx_hash) = '' THEN
        RAISE EXCEPTION 'p_sweep_tx_hash cannot be null or empty';
    END IF;

    -- 2. Lock the sweep operations row exclusively
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    -- 3. Verify worker ownership
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Sweep operation belongs to another worker');
    END IF;

    -- 4. Verify valid source status (ONLY CLAIMED allowed)
    IF v_sweep.status NOT IN ('CLAIMED') THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'INVALID_SOURCE_STATE', 
            'message', 'Signed transaction persistence is only allowed for sweeps in CLAIMED state. Current state: ' || v_sweep.status
        );
    END IF;

    -- 5. Verify expected current status matches caller-supplied expected status
    IF v_sweep.status <> p_expected_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'STATE_MISMATCH', 'message', 'Current state ' || v_sweep.status || ' does not match expected ' || p_expected_status);
    END IF;

    -- 6. Verify lease expiry
    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- 7. Require BTC/LTC compatible network
    v_net_code := UPPER(TRIM(v_sweep.network));
    IF v_net_code NOT IN ('BTC', 'LTC') THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK', 'message', 'Only BTC and LTC networks are supported for signed transaction persistence');
    END IF;

    -- 8. Reject overwriting existing different signed_tx_hex
    IF v_sweep.signed_tx_hex IS NOT NULL AND v_sweep.signed_tx_hex <> TRIM(p_signed_tx_hex) THEN
        RETURN jsonb_build_object('success', false, 'code', 'SIGNED_TX_MUTATION_REJECTED', 'message', 'Cannot overwrite an already persisted signed transaction payload');
    END IF;

    -- 9. Reject overwriting existing different sweep_tx_hash
    IF v_sweep.sweep_tx_hash IS NOT NULL AND v_sweep.sweep_tx_hash <> TRIM(p_sweep_tx_hash) THEN
        RETURN jsonb_build_object('success', false, 'code', 'TX_HASH_MUTATION_REJECTED', 'message', 'Cannot overwrite an already persisted sweep transaction hash');
    END IF;

    -- 10. Atomically update status to READY_TO_BROADCAST and save signed bytes & hash
    UPDATE public.sweep_operations
    SET status = 'READY_TO_BROADCAST',
        signed_tx_hex = TRIM(p_signed_tx_hex),
        sweep_tx_hash = TRIM(p_sweep_tx_hash),
        lease_expires_at = v_new_lease,
        updated_at = NOW()
    WHERE id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'sweep_id', p_sweep_id,
        'status', 'READY_TO_BROADCAST',
        'sweep_tx_hash', TRIM(p_sweep_tx_hash)
    );
END;
$$;

-- Revoke default PUBLIC / anon / authenticated / auth admin privileges
REVOKE EXECUTE ON FUNCTION public.persist_signed_btc_ltc_transaction(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

-- Grant execution privileges to authorized roles
GRANT EXECUTE ON FUNCTION public.persist_signed_btc_ltc_transaction(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role, postgres;

COMMIT;
