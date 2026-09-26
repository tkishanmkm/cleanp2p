-- ============================================================================
-- Supabase Migration: 20260925000005_blocker_4_state_machine_hardening.sql
-- Description: Blocker #4 Fix - State Machine Hardening for Nonce Preservation
--              Protects EVM deposit address nonces by prohibiting transitions
--              of nonced sweep operations to a terminal FAILED state.
-- ============================================================================

BEGIN;

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

    -- Strict State Machine Transition Rules (NO direct CLAIMED -> BROADCASTED or GAS_FUNDED -> BROADCASTED)
    CASE p_expected_status
        WHEN 'PENDING' THEN
            v_valid_transition := p_new_status IN ('CLAIMED', 'FAILED');
        WHEN 'CLAIMED' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDING', 'GAS_FUNDED', 'READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDING' THEN
            v_valid_transition := p_new_status IN ('GAS_FUNDED', 'READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED');
        WHEN 'GAS_FUNDED' THEN
            v_valid_transition := p_new_status IN ('READY_TO_BROADCAST', 'FAILED', 'RECOVERY_REQUIRED');
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

    -- Nonce-Preservation Hardening: Prevent transitioning a nonced operation to FAILED
    IF v_sweep.nonce IS NOT NULL AND p_new_status = 'FAILED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NONCED_SWEEP_CANNOT_FAIL',
            'message', 'Cannot transition a sweep with an allocated nonce directly to FAILED; resolve or retry the existing nonce.'
        );
    END IF;

    -- Enforce non-null and non-empty transaction hash when transitioning to BROADCASTED
    IF p_new_status = 'BROADCASTED' 
       AND NULLIF(TRIM(COALESCE(p_tx_hash, v_sweep.sweep_tx_hash)), '') IS NULL 
    THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'BROADCASTED_REQUIRES_TX_HASH',
            'message', 'BROADCASTED status requires a transaction hash'
        );
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

-- Explicitly revoke permissions from PUBLIC roles and grant to service_role / postgres
REVOKE EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) FROM PUBLIC, anon, authenticated, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.update_sweep_operation_status(UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER) TO service_role, postgres;

COMMIT;
