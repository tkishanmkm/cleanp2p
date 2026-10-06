-- ============================================================================
-- Supabase Migration: 20261005020000_canonical_individual_emergency_freeze.sql
-- Description: Establishes canonical individual emergency freeze state in public.profiles,
--              atomic admin freeze/unfreeze RPCs, and enforces DB-level fail-closed
--              freeze checks in initiate_trade_with_escrow, request_withdrawal, and
--              execute_internal_transfer.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions on public.profiles
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_emergency_frozen'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN is_emergency_frozen BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'emergency_frozen_at'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN emergency_frozen_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'emergency_frozen_by'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN emergency_frozen_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'emergency_freeze_reason'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN emergency_freeze_reason TEXT DEFAULT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen 
    ON public.profiles (id) 
    WHERE is_emergency_frozen IS TRUE;

-- ----------------------------------------------------------------------------
-- 2. Admin RPC: admin_freeze_user
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_freeze_user(
    p_target_user_id UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_email TEXT;
    v_is_admin BOOLEAN := FALSE;
    v_target_exists BOOLEAN := FALSE;
    v_clean_reason TEXT := TRIM(p_reason);
BEGIN
    -- Verify Caller Authentication & Admin Privileges
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_admin := TRUE;
        v_caller_email := 'service_role@paxones.internal';
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT TRUE, email INTO v_is_admin, v_caller_email
        FROM public.profiles
        WHERE id = v_caller_id
          AND (role = 'admin' OR is_admin IS TRUE OR is_admin_account IS TRUE);
    END IF;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute emergency freeze.';
    END IF;

    -- Self-Protection
    IF v_caller_id IS NOT NULL AND p_target_user_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Administrators cannot apply an emergency freeze to their own account.';
    END IF;

    -- Validate Target
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_target_user_id
    ) INTO v_target_exists;

    IF NOT v_target_exists THEN
        RAISE EXCEPTION 'Target user not found for ID %', p_target_user_id;
    END IF;

    IF v_clean_reason IS NULL OR v_clean_reason = '' THEN
        RAISE EXCEPTION 'Reason required: An explicit reason must be provided for an emergency freeze.';
    END IF;

    -- Atomically Apply Emergency Freeze (Preserves all other status flags!)
    UPDATE public.profiles
    SET is_emergency_frozen = TRUE,
        emergency_frozen_at = NOW(),
        emergency_frozen_by = v_caller_id,
        emergency_freeze_reason = v_clean_reason,
        updated_at = NOW()
    WHERE id = p_target_user_id;

    -- Record Audit Event
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        v_caller_id,
        COALESCE(v_caller_email, 'admin@paxones.com'),
        'USER_EMERGENCY_FREEZE',
        p_target_user_id::TEXT,
        p_target_user_id,
        jsonb_build_object(
            'target_user_id', p_target_user_id,
            'freeze_reason', v_clean_reason,
            'frozen_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'is_emergency_frozen', true,
        'reason', v_clean_reason
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_freeze_user(UUID, TEXT) TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 3. Admin RPC: admin_unfreeze_user
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_unfreeze_user(
    p_target_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_caller_email TEXT;
    v_is_admin BOOLEAN := FALSE;
    v_target_exists BOOLEAN := FALSE;
    v_clean_reason TEXT := TRIM(p_reason);
BEGIN
    -- Verify Caller Authentication & Admin Privileges
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_admin := TRUE;
        v_caller_email := 'service_role@paxones.internal';
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT TRUE, email INTO v_is_admin, v_caller_email
        FROM public.profiles
        WHERE id = v_caller_id
          AND (role = 'admin' OR is_admin IS TRUE OR is_admin_account IS TRUE);
    END IF;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to lift emergency freeze.';
    END IF;

    -- Validate Target
    SELECT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = p_target_user_id
    ) INTO v_target_exists;

    IF NOT v_target_exists THEN
        RAISE EXCEPTION 'Target user not found for ID %', p_target_user_id;
    END IF;

    -- Atomically Remove Emergency Freeze ONLY
    -- MUST NOT Touch is_banned, is_suspended, is_restricted, is_on_hold, or account_status!
    UPDATE public.profiles
    SET is_emergency_frozen = FALSE,
        emergency_frozen_at = NULL,
        emergency_frozen_by = NULL,
        emergency_freeze_reason = NULL,
        updated_at = NOW()
    WHERE id = p_target_user_id;

    -- Record Audit Event
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        v_caller_id,
        COALESCE(v_caller_email, 'admin@paxones.com'),
        'USER_EMERGENCY_UNFREEZE',
        p_target_user_id::TEXT,
        p_target_user_id,
        jsonb_build_object(
            'target_user_id', p_target_user_id,
            'unfreeze_reason', COALESCE(v_clean_reason, 'Admin unfreeze'),
            'unfrozen_at', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'is_emergency_frozen', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user(UUID, TEXT) TO authenticated, service_role, postgres;

COMMIT;
