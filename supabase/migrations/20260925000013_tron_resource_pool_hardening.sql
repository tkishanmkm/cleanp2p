-- ============================================================================
-- Supabase Migration: 20260925000013_tron_resource_pool_hardening.sql
-- Description: TRON Resource Pool Concurrency & Durability Hardening
--              1. Adds signed_tx_hex column to gas_funding_operations
--              2. Adds verified_onchain_undelegated column to resource_delegation_operations
--              3. Updates gas_funding_operations check constraints for READY_TO_BROADCAST
--              4. Updates resource_delegation_operations check constraints for RECOVERY_REQUIRED
--              5. Creates claim_or_initialize_resource_delegation RPC (Blocker #2)
--              6. Creates verify_and_lock_pre_broadcast_cleanup RPC (Blocker #1)
--              7. Creates persist_signed_gas_funding RPC (Blocker #9 Fix - READY_TO_BROADCAST)
--              8. Creates hardened confirm_resource_undelegated RPC (Blockers #7 & #8 Fix)
-- ============================================================================

BEGIN;

-- 1. Add schema columns if not existing
ALTER TABLE public.gas_funding_operations
    ADD COLUMN IF NOT EXISTS signed_tx_hex TEXT;

ALTER TABLE public.resource_delegation_operations
    ADD COLUMN IF NOT EXISTS verified_onchain_undelegated BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Update status check constraints
ALTER TABLE public.gas_funding_operations
    DROP CONSTRAINT IF EXISTS gas_funding_operations_status_check;

ALTER TABLE public.gas_funding_operations
    ADD CONSTRAINT gas_funding_operations_status_check
    CHECK (status IN ('PENDING', 'READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'FAILED', 'RECOVERY_REQUIRED'));

ALTER TABLE public.resource_delegation_operations
    DROP CONSTRAINT IF EXISTS resource_delegation_operations_status_check;

ALTER TABLE public.resource_delegation_operations
    ADD CONSTRAINT resource_delegation_operations_status_check
    CHECK (status IN ('PENDING', 'ACTIVATING', 'ACTIVATED', 'DELEGATING', 'DELEGATED', 'UNDELEGATING', 'UNDELEGATED', 'RECOVERY_REQUIRED', 'FAILED'));

-- 3. Create RPC: claim_or_initialize_resource_delegation (Blocker #2 Fix)
CREATE OR REPLACE FUNCTION public.claim_or_initialize_resource_delegation(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_pool_address TEXT,
    p_receiver_address TEXT,
    p_delegated_amount_sun BIGINT,
    p_delegated_energy BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_delegation RECORD;
    v_delegation_id UUID;
BEGIN
    -- Assert sweep exists, owned by worker, and lease is valid
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Sweep operation owned by another worker');
    END IF;

    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- Lock existing delegation row if present
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF FOUND THEN
        -- If active or already delegated, DO NOT overwrite or reset to PENDING!
        IF v_delegation.status IN ('DELEGATING', 'DELEGATED', 'UNDELEGATING') THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_delegated', true,
                'status', v_delegation.status,
                'delegation_id', v_delegation.id,
                'delegated_amount_sun', v_delegation.delegated_amount_sun,
                'delegation_tx_hash', v_delegation.delegation_tx_hash,
                'signed_delegation_hex', v_delegation.signed_delegation_hex
            );
        END IF;

        IF v_delegation.status = 'UNDELEGATED' THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'ALREADY_UNDELEGATED',
                'message', 'Resource delegation for this sweep is already completed and undelegated'
            );
        END IF;

        -- For PENDING or FAILED, update safely
        UPDATE public.resource_delegation_operations
        SET pool_address = TRIM(p_pool_address),
            receiver_address = TRIM(p_receiver_address),
            delegated_amount_sun = p_delegated_amount_sun,
            delegated_energy = p_delegated_energy,
            status = 'PENDING',
            error_message = NULL,
            updated_at = NOW()
        WHERE sweep_id = p_sweep_id
        RETURNING id INTO v_delegation_id;

        RETURN jsonb_build_object(
            'success', true,
            'already_delegated', false,
            'delegation_id', v_delegation_id,
            'status', 'PENDING'
        );
    ELSE
        -- Insert new delegation row
        INSERT INTO public.resource_delegation_operations (
            sweep_id,
            pool_address,
            receiver_address,
            delegated_amount_sun,
            delegated_energy,
            status,
            updated_at
        ) VALUES (
            p_sweep_id,
            TRIM(p_pool_address),
            TRIM(p_receiver_address),
            p_delegated_amount_sun,
            p_delegated_energy,
            'PENDING',
            NOW()
        )
        RETURNING id INTO v_delegation_id;

        RETURN jsonb_build_object(
            'success', true,
            'already_delegated', false,
            'delegation_id', v_delegation_id,
            'status', 'PENDING'
        );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_or_initialize_resource_delegation(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_or_initialize_resource_delegation(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) TO service_role, postgres;

-- 4. Create RPC: verify_and_lock_pre_broadcast_cleanup (Blocker #1 Fix)
CREATE OR REPLACE FUNCTION public.verify_and_lock_pre_broadcast_cleanup(
    p_sweep_id UUID,
    p_worker_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_delegation RECORD;
BEGIN
    -- Assert sweep exists and lock row
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('can_undelegate', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('can_undelegate', false, 'code', 'WORKER_MISMATCH', 'message', 'Worker does not own sweep');
    END IF;

    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('can_undelegate', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease has expired');
    END IF;

    -- Pre-broadcast cleanup is ONLY allowed strictly before broadcast (CLAIMED, GAS_FUNDING, GAS_FUNDED)
    IF v_sweep.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'RECOVERY_REQUIRED') THEN
        RETURN jsonb_build_object(
            'can_undelegate', false,
            'code', 'INVALID_SWEEP_STATUS',
            'status', v_sweep.status,
            'message', 'Sweep has already reached broadcast/recovery state. Pre-broadcast cleanup forbidden.'
        );
    END IF;

    -- Lock delegation record
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND OR v_delegation.status NOT IN ('DELEGATING', 'DELEGATED') THEN
        RETURN jsonb_build_object(
            'can_undelegate', false,
            'code', 'NO_ACTIVE_DELEGATION',
            'message', 'No active delegation found to clean up'
        );
    END IF;

    -- Transition sweep to RECOVERY_REQUIRED atomically so no other worker takes it during undelegation
    UPDATE public.sweep_operations
    SET status = 'RECOVERY_REQUIRED',
        error_message = 'Pre-broadcast failure. Cleaning up resources.',
        updated_at = NOW()
    WHERE id = p_sweep_id;

    RETURN jsonb_build_object(
        'can_undelegate', true,
        'status', 'RECOVERY_REQUIRED',
        'delegated_amount_sun', v_delegation.delegated_amount_sun,
        'receiver_address', v_delegation.receiver_address
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_and_lock_pre_broadcast_cleanup(UUID, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.verify_and_lock_pre_broadcast_cleanup(UUID, TEXT) TO service_role, postgres;

-- 5. Create RPC: persist_signed_gas_funding (Blocker #9 Fix - Sets READY_TO_BROADCAST)
CREATE OR REPLACE FUNCTION public.persist_signed_gas_funding(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_signed_tx_hex TEXT,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_gas RECORD;
BEGIN
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Worker does not own sweep');
    END IF;

    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease expired');
    END IF;

    SELECT * INTO v_gas
    FROM public.gas_funding_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'GAS_OP_NOT_FOUND', 'message', 'Gas funding operation not found');
    END IF;

    -- Set status to READY_TO_BROADCAST (persisted before network broadcast)
    UPDATE public.gas_funding_operations
    SET signed_tx_hex = TRIM(p_signed_tx_hex),
        tx_hash = TRIM(p_tx_hash),
        status = 'READY_TO_BROADCAST',
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'READY_TO_BROADCAST',
        'tx_hash', TRIM(p_tx_hash)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_gas_funding(UUID, TEXT, TEXT, TEXT) TO service_role, postgres;

-- 6. Create RPC: confirm_resource_undelegated (Blocker #8 Hardening)
CREATE OR REPLACE FUNCTION public.confirm_resource_undelegated(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_undelegation_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sweep RECORD;
    v_delegation RECORD;
BEGIN
    -- 1. Assert sweep exists and verify ownership & lease
    SELECT * INTO v_sweep
    FROM public.sweep_operations
    WHERE id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND', 'message', 'Sweep operation not found');
    END IF;

    IF v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'WORKER_MISMATCH', 'message', 'Worker does not own sweep');
    END IF;

    IF v_sweep.lease_expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'LEASE_EXPIRED', 'message', 'Worker lease expired');
    END IF;

    -- 2. Lock delegation row
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'DELEGATION_NOT_FOUND', 'message', 'Resource delegation operation record not found');
    END IF;

    -- 3. Idempotency: if already UNDELEGATED and verified_onchain_undelegated=true with same tx hash
    IF v_delegation.status = 'UNDELEGATED' AND v_delegation.verified_onchain_undelegated = true THEN
        IF p_undelegation_tx_hash IS NULL OR v_delegation.undelegation_tx_hash = TRIM(p_undelegation_tx_hash) THEN
            RETURN jsonb_build_object(
                'success', true,
                'already_confirmed', true,
                'status', 'UNDELEGATED',
                'message', 'Delegation already verified and marked UNDELEGATED'
            );
        END IF;
    END IF;

    -- 4. Require current status = 'UNDELEGATING'
    IF v_delegation.status IS DISTINCT FROM 'UNDELEGATING' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_DELEGATION_STATUS',
            'status', v_delegation.status,
            'message', 'confirm_resource_undelegated requires current status UNDELEGATING. Current is ' || v_delegation.status
        );
    END IF;

    -- 5. Require tx_hash match if stored
    IF v_delegation.undelegation_tx_hash IS NOT NULL AND p_undelegation_tx_hash IS NOT NULL THEN
        IF v_delegation.undelegation_tx_hash IS DISTINCT FROM TRIM(p_undelegation_tx_hash) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'TX_HASH_MISMATCH',
                'message', 'Provided undelegation tx hash does not match stored tx hash'
            );
        END IF;
    END IF;

    -- 6. Transition to UNDELEGATED and mark verified_onchain_undelegated = true
    UPDATE public.resource_delegation_operations
    SET status = 'UNDELEGATED',
        verified_onchain_undelegated = true,
        undelegation_tx_hash = COALESCE(TRIM(p_undelegation_tx_hash), v_delegation.undelegation_tx_hash),
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'UNDELEGATED',
        'verified_onchain_undelegated', true
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_resource_undelegated(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.confirm_resource_undelegated(UUID, TEXT, TEXT) TO service_role, postgres;

COMMIT;
