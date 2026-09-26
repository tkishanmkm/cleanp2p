-- ============================================================================
-- Supabase Migration: 20260925000001_blocker_2_recovery_hardening.sql
-- Description: Blocker #2 Fix - Pre-Broadcast State & Ambiguous Recovery Hardening
--              1. Add READY_TO_BROADCAST state to sweep_operations
--              2. Update claim_next_deposit_sweep to safely recover expired READY_TO_BROADCAST
--              3. Update update_sweep_operation_status with READY_TO_BROADCAST state transitions
--              4. Revoke PUBLIC execution and grant to service_role, postgres
-- ============================================================================

BEGIN;

-- 1. Update sweep_operations status check constraint to include READY_TO_BROADCAST
ALTER TABLE public.sweep_operations DROP CONSTRAINT IF EXISTS sweep_operations_status_check;
ALTER TABLE public.sweep_operations ADD CONSTRAINT sweep_operations_status_check CHECK (status IN (
    'PENDING', 'CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'
));

-- 2. Update claim_next_deposit_sweep RPC to recover expired READY_TO_BROADCAST
CREATE OR REPLACE FUNCTION public.claim_next_deposit_sweep(
    p_worker_id TEXT,
    p_lease_duration_seconds INTEGER DEFAULT 300
)
RETURNS TABLE (
    sweep_id UUID,
    deposit_id UUID,
    deposit_address TEXT,
    network TEXT,
    asset_symbol TEXT,
    derivation_index INTEGER,
    status TEXT,
    lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_candidate RECORD;
    v_new_lease TIMESTAMPTZ := NOW() + (p_lease_duration_seconds || ' seconds')::INTERVAL;
BEGIN
    -- Auto-create sweep_operations for confirmed unswept deposits not yet in sweep_operations
    INSERT INTO public.sweep_operations (deposit_id, deposit_address, network, asset_symbol, derivation_index, status)
    SELECT 
        d.id,
        COALESCE(d.address, d.to_address),
        UPPER(TRIM(d.network)),
        UPPER(TRIM(COALESCE(d.asset_symbol, 'USDT'))),
        0,
        'PENDING'
    FROM public.onchain_deposits d
    WHERE d.status = 'CONFIRMED'
      AND d.is_swept = FALSE
      AND NOT EXISTS (SELECT 1 FROM public.sweep_operations s WHERE s.deposit_id = d.id)
    ON CONFLICT (deposit_id) DO NOTHING;

    -- Select next eligible pending or recoverable expired sweep using FOR UPDATE SKIP LOCKED
    -- NOTE: READY_TO_BROADCAST is eligible for lease recovery ONLY when lease has expired
    -- BROADCASTED and RECOVERY_REQUIRED are NEVER automatically reclaimed.
    SELECT s.id INTO v_candidate
    FROM public.sweep_operations s
    WHERE s.status = 'PENDING'
       OR (s.status IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST') AND s.lease_expires_at < NOW())
    ORDER BY s.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_candidate IS NULL THEN
        RETURN;
    END IF;

    -- Atomically update status to CLAIMED and set lease
    UPDATE public.sweep_operations s
    SET status = 'CLAIMED',
        worker_id = p_worker_id,
        lease_expires_at = v_new_lease,
        updated_at = NOW()
    WHERE s.id = v_candidate.id;

    RETURN QUERY
    SELECT 
        s.id AS sweep_id,
        s.deposit_id,
        s.deposit_address,
        s.network,
        s.asset_symbol,
        s.derivation_index,
        s.status,
        s.lease_expires_at
    FROM public.sweep_operations s
    WHERE s.id = v_candidate.id;
END;
$$;

-- 3. Update update_sweep_operation_status RPC to support READY_TO_BROADCAST
CREATE OR REPLACE FUNCTION public.update_sweep_operation_status(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_new_status TEXT,
    p_tx_hash TEXT DEFAULT NULL,
    p_amount_swept NUMERIC DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
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
    v_valid_transition BOOLEAN := FALSE;
BEGIN
    IF p_expected_status IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'MISSING_EXPECTED_STATUS', 'message', 'p_expected_status parameter is required');
    END IF;

    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    -- Validate worker ownership
    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Sweep operation belongs to another worker');
    END IF;

    -- Validate lease expiry for non-terminal states
    IF v_sweep.lease_expires_at < NOW() AND p_new_status NOT IN ('FAILED', 'RECOVERY_REQUIRED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- Validate expected current status
    IF v_sweep.status <> p_expected_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'STATE_MISMATCH', 'message', 'Current state ' || v_sweep.status || ' does not match expected ' || p_expected_status);
    END IF;

    -- Strict State Machine Transition Rules
    CASE p_expected_status
        WHEN 'PENDING' THEN
            v_valid_transition := p_new_status IN ('CLAIMED', 'FAILED');
        WHEN 'CLAIMED' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST', 'BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDING' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDED', 'READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDED' THEN
            v_valid_transition := p_new_status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'READY_TO_BROADCAST' THEN
            v_valid_transition := p_new_status IN ('BROADCASTED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'BROADCASTED' THEN
            v_valid_transition := p_new_status IN ('CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'RECOVERY_REQUIRED' THEN
            v_valid_transition := p_new_status IN ('CONFIRMED', 'FAILED');
        ELSE
            v_valid_transition := FALSE;
    END CASE;

    IF NOT v_valid_transition THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_STATE_TRANSITION', 'message', 'Transition from ' || p_expected_status || ' to ' || p_new_status || ' is invalid');
    END IF;

    -- Update sweep operation record
    UPDATE public.sweep_operations
    SET status = p_new_status,
        lease_expires_at = CASE WHEN p_new_status IN ('CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED') THEN NULL ELSE v_new_lease END,
        sweep_tx_hash = COALESCE(p_tx_hash, sweep_tx_hash),
        amount_swept = COALESCE(p_amount_swept, amount_swept),
        error_message = COALESCE(p_error_message, error_message),
        updated_at = NOW()
    WHERE id = p_sweep_id;

    -- Handle cascade updates
    IF p_new_status = 'CONFIRMED' THEN
        UPDATE public.onchain_deposits
        SET is_swept = TRUE,
            swept_tx_hash = COALESCE(p_tx_hash, swept_tx_hash),
            updated_at = NOW()
        WHERE id = v_sweep.deposit_id;

        UPDATE public.utxo_reservations
        SET status = 'CONFIRMED', reserved_until = NOW() + INTERVAL '1 day'
        WHERE sweep_id = p_sweep_id;
    ELSIF p_new_status = 'RECOVERY_REQUIRED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RECOVERY_REQUIRED', reserved_until = NOW() + INTERVAL '7 days'
        WHERE sweep_id = p_sweep_id;
    ELSIF p_new_status = 'FAILED' THEN
        UPDATE public.utxo_reservations
        SET status = 'RELEASED', reserved_until = NOW()
        WHERE sweep_id = p_sweep_id AND status = 'RESERVED';
    END IF;

    RETURN jsonb_build_object('success', true, 'sweep_id', p_sweep_id, 'status', p_new_status);
END;
$$;

-- 4. Revoke PUBLIC execution and grant only to service_role, postgres
REVOKE EXECUTE ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.claim_next_deposit_sweep(TEXT, INTEGER) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) TO service_role, postgres;

COMMIT;
