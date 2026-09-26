-- ============================================================================
-- Supabase Migration: 20260925000012_tron_resource_pool.sql
-- Description: TRON Centralized Energy Resource Pool Schema & Durability RPCs
--              1. Creates public.resource_delegation_operations table
--              2. Implements RLS and grants permissions
--              3. Creates RPCs to safely record, persist and transition delegation states
-- ============================================================================

BEGIN;

-- 1. Create resource_delegation_operations table
CREATE TABLE IF NOT EXISTS public.resource_delegation_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sweep_id UUID NOT NULL REFERENCES public.sweep_operations(id) ON DELETE CASCADE,
    pool_address TEXT NOT NULL,
    receiver_address TEXT NOT NULL,
    delegated_amount_sun BIGINT NOT NULL,
    delegated_energy BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING', 'ACTIVATING', 'ACTIVATED', 'DELEGATING', 'DELEGATED', 'UNDELEGATING', 'UNDELEGATED', 'FAILED'
    )),
    delegation_tx_hash TEXT,
    signed_delegation_hex TEXT,
    undelegation_tx_hash TEXT,
    signed_undelegation_hex TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_resource_delegation_sweep UNIQUE (sweep_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_resource_delegation_status ON public.resource_delegation_operations(status);
CREATE INDEX IF NOT EXISTS idx_resource_delegation_sweep ON public.resource_delegation_operations(sweep_id);
CREATE INDEX IF NOT EXISTS idx_resource_delegation_receiver ON public.resource_delegation_operations(receiver_address);

-- Enable RLS
ALTER TABLE public.resource_delegation_operations ENABLE ROW LEVEL SECURITY;

-- Security Policy: service_role full access
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'resource_delegation_operations' 
        AND policyname = 'Service role full access to resource_delegation_operations'
    ) THEN
        CREATE POLICY "Service role full access to resource_delegation_operations"
            ON public.resource_delegation_operations FOR ALL TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- 2. Create RPC: initialize_resource_delegation
CREATE OR REPLACE FUNCTION public.initialize_resource_delegation(
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
    v_delegation_id UUID;
BEGIN
    -- Assert sweep exists and belongs to the worker
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

    -- Upsert/insert resource delegation operations row
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
    ON CONFLICT (sweep_id) DO UPDATE
    SET pool_address = EXCLUDED.pool_address,
        receiver_address = EXCLUDED.receiver_address,
        delegated_amount_sun = EXCLUDED.delegated_amount_sun,
        delegated_energy = EXCLUDED.delegated_energy,
        status = 'PENDING',
        error_message = NULL,
        updated_at = NOW()
    RETURNING id INTO v_delegation_id;

    RETURN jsonb_build_object(
        'success', true,
        'delegation_id', v_delegation_id,
        'status', 'PENDING'
    );
END;
$$;

-- Revoke default PUBLIC privileges
REVOKE EXECUTE ON FUNCTION public.initialize_resource_delegation(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.initialize_resource_delegation(UUID, TEXT, TEXT, TEXT, BIGINT, BIGINT) TO service_role, postgres;

-- 3. Create RPC: persist_signed_delegation
CREATE OR REPLACE FUNCTION public.persist_signed_delegation(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_signed_delegation_hex TEXT,
    p_delegation_tx_hash TEXT
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
    -- Verify sweep status & lease
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

    -- Lock and verify delegation operation
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'DELEGATION_NOT_FOUND', 'message', 'Resource delegation operation record not found');
    END IF;

    -- Transition status to DELEGATING and store signed hex
    UPDATE public.resource_delegation_operations
    SET status = 'DELEGATING',
        signed_delegation_hex = TRIM(p_signed_delegation_hex),
        delegation_tx_hash = TRIM(p_delegation_tx_hash),
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'DELEGATING',
        'delegation_tx_hash', TRIM(p_delegation_tx_hash)
    );
END;
$$;

-- Revoke default PUBLIC privileges
REVOKE EXECUTE ON FUNCTION public.persist_signed_delegation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_delegation(UUID, TEXT, TEXT, TEXT) TO service_role, postgres;

-- 4. Create RPC: update_delegation_status
CREATE OR REPLACE FUNCTION public.update_delegation_status(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_expected_status TEXT,
    p_new_status TEXT,
    p_error_message TEXT DEFAULT NULL
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
    -- Verify sweep owner & lease
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

    -- Lock delegation record
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'DELEGATION_NOT_FOUND', 'message', 'Resource delegation operation record not found');
    END IF;

    -- Check expected status
    IF v_delegation.status IS DISTINCT FROM p_expected_status THEN
        RETURN jsonb_build_object('success', false, 'code', 'STATE_MISMATCH', 'message', 'Delegation state ' || v_delegation.status || ' does not match expected ' || p_expected_status);
    END IF;

    -- Update delegation status
    UPDATE public.resource_delegation_operations
    SET status = p_new_status,
        error_message = p_error_message,
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', p_new_status
    );
END;
$$;

-- Revoke default PUBLIC privileges
REVOKE EXECUTE ON FUNCTION public.update_delegation_status(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_delegation_status(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role, postgres;

-- 5. Create RPC: persist_signed_undelegation
CREATE OR REPLACE FUNCTION public.persist_signed_undelegation(
    p_sweep_id UUID,
    p_worker_id TEXT,
    p_signed_undelegation_hex TEXT,
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
    -- Verify sweep owner
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

    -- Lock and verify delegation record
    SELECT * INTO v_delegation
    FROM public.resource_delegation_operations
    WHERE sweep_id = p_sweep_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'DELEGATION_NOT_FOUND', 'message', 'Resource delegation operation record not found');
    END IF;

    -- Require current state to be DELEGATED or FAILED (reclaim attempt)
    IF v_delegation.status NOT IN ('DELEGATED', 'FAILED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_SOURCE_STATE', 'message', 'Undelegation is only allowed from DELEGATED or FAILED status');
    END IF;

    -- Transition status to UNDELEGATING and store signed hex
    UPDATE public.resource_delegation_operations
    SET status = 'UNDELEGATING',
        signed_undelegation_hex = TRIM(p_signed_undelegation_hex),
        undelegation_tx_hash = TRIM(p_undelegation_tx_hash),
        updated_at = NOW()
    WHERE sweep_id = p_sweep_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'UNDELEGATING',
        'undelegation_tx_hash', TRIM(p_undelegation_tx_hash)
    );
END;
$$;

-- Revoke default PUBLIC privileges
REVOKE EXECUTE ON FUNCTION public.persist_signed_undelegation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_undelegation(UUID, TEXT, TEXT, TEXT) TO service_role, postgres;

COMMIT;
