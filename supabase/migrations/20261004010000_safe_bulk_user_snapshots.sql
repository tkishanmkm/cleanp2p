-- Migration: 20261004010000_safe_bulk_user_snapshots.sql
-- Description: State-preserving persistent snapshot storage and atomic database RPCs
--              for bulk user ban/unban and restrict/unrestrict emergency operations.
--              Guarantees that pre-existing manual/fraud/KYC bans and suspensions are never wiped.

-- 1. Create dedicated snapshot table for tracking pre-bulk operation states
CREATE TABLE IF NOT EXISTS public.admin_user_status_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_type TEXT NOT NULL CHECK (operation_type IN ('BULK_BAN', 'BULK_RESTRICT')),
    operation_run_id TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    previous_status TEXT,
    previous_is_banned BOOLEAN,
    previous_is_suspended BOOLEAN,
    previous_ban_reason TEXT,
    previous_banned_at TIMESTAMPTZ,
    is_restored BOOLEAN NOT NULL DEFAULT FALSE,
    restored_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_admin_id UUID,
    created_by_admin_email TEXT
);

-- Indexes for rapid lookup during restore and duplicate prevention
CREATE INDEX IF NOT EXISTS idx_status_snapshots_lookup 
    ON public.admin_user_status_snapshots (operation_type, is_restored, operation_run_id);

CREATE INDEX IF NOT EXISTS idx_status_snapshots_user 
    ON public.admin_user_status_snapshots (user_id);

-- 2. Enable RLS and establish strict admin-only policies
ALTER TABLE public.admin_user_status_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_user_status_snapshots FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.admin_user_status_snapshots TO authenticated;
GRANT ALL ON TABLE public.admin_user_status_snapshots TO service_role;

DROP POLICY IF EXISTS "admin_user_status_snapshots_select_policy" ON public.admin_user_status_snapshots;
DROP POLICY IF EXISTS "admin_user_status_snapshots_mutate_policy" ON public.admin_user_status_snapshots;

CREATE POLICY "admin_user_status_snapshots_select_policy" ON public.admin_user_status_snapshots
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()::uuid
              AND (
                role = 'admin'
                OR is_admin = true
                OR is_admin_account = true
              )
        )
    );

CREATE POLICY "admin_user_status_snapshots_mutate_policy" ON public.admin_user_status_snapshots
    FOR ALL
    USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()::uuid
              AND (
                role = 'admin'
                OR is_admin = true
                OR is_admin_account = true
              )
        )
    )
    WITH CHECK (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid()::uuid
              AND (
                role = 'admin'
                OR is_admin = true
                OR is_admin_account = true
              )
        )
    );

-- 3. Atomic Bulk Ban Function
CREATE OR REPLACE FUNCTION public.execute_bulk_ban_atomic(
    p_admin_id UUID,
    p_admin_email TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_authorized BOOLEAN := FALSE;
    v_run_id TEXT;
    v_affected_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_user RECORD;
    v_target_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    v_caller_id := auth.uid();
    
    -- Verify authorization (service_role or authenticated admin profile)
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_caller_id
              AND (role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE)
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk ban.';
    END IF;

    -- Generate unique run ID
    v_run_id := 'run_ban_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(gen_random_uuid()::TEXT, 1, 8);

    -- Loop over candidate non-admin users who are not currently banned
    -- and do not already have an active un-restored BULK_BAN snapshot
    FOR v_user IN
        SELECT p.id, p.status, p.is_banned, p.is_suspended, p.ban_reason, p.banned_at
        FROM public.profiles p
        WHERE (p.role IS NULL OR p.role != 'admin')
          AND p.is_admin IS NOT TRUE
          AND p.is_admin_account IS NOT TRUE
          AND (p.email IS NULL OR lower(p.email) != 'km8870960@gmail.com')
          AND (p_admin_id IS NULL OR p.id != p_admin_id)
          AND (p.is_banned IS FALSE OR p.is_banned IS NULL)
          AND (p.status IS NULL OR p.status != 'banned')
          AND NOT EXISTS (
              SELECT 1 FROM public.admin_user_status_snapshots s
              WHERE s.user_id = p.id
                AND s.operation_type = 'BULK_BAN'
                AND s.is_restored IS FALSE
          )
        FOR UPDATE
    LOOP
        -- 1. Snapshot prior state
        INSERT INTO public.admin_user_status_snapshots (
            operation_type,
            operation_run_id,
            user_id,
            previous_status,
            previous_is_banned,
            previous_is_suspended,
            previous_ban_reason,
            previous_banned_at,
            created_by_admin_id,
            created_by_admin_email,
            is_restored,
            created_at
        ) VALUES (
            'BULK_BAN',
            v_run_id,
            v_user.id,
            COALESCE(v_user.status, 'active'),
            COALESCE(v_user.is_banned, FALSE),
            COALESCE(v_user.is_suspended, FALSE),
            v_user.ban_reason,
            v_user.banned_at,
            p_admin_id,
            p_admin_email,
            FALSE,
            NOW()
        );

        v_target_ids := array_append(v_target_ids, v_user.id);
        v_affected_count := v_affected_count + 1;
    END LOOP;

    -- Count pre-existing banned users that were skipped and preserved
    SELECT count(*) INTO v_skipped_count
    FROM public.profiles p
    WHERE (p.is_banned IS TRUE OR p.status = 'banned')
      AND (p.role IS NULL OR p.role != 'admin')
      AND p.is_admin IS NOT TRUE
      AND p.is_admin_account IS NOT TRUE;

    -- 2. Atomically update eligible target users
    IF v_affected_count > 0 THEN
        UPDATE public.profiles
        SET status = 'banned',
            is_banned = TRUE,
            ban_reason = COALESCE(p_reason, 'Global administrator administrative ban'),
            banned_at = NOW(),
            updated_at = NOW()
        WHERE id = ANY(v_target_ids);
    END IF;

    -- 3. Log audit record
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        p_admin_email,
        'BULK_USERS_BANNED',
        v_run_id,
        jsonb_build_object(
            'run_id', v_run_id,
            'affected_count', v_affected_count,
            'pre_existing_banned_preserved', v_skipped_count,
            'reason', COALESCE(p_reason, 'Global administrator administrative ban'),
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'run_id', v_run_id,
        'affected_count', v_affected_count,
        'skipped_count', v_skipped_count,
        'message', format('Successfully banned %s users. %s pre-existing banned users preserved.', v_affected_count, v_skipped_count)
    );
END;
$$;

-- 4. Atomic Bulk Unban Function
CREATE OR REPLACE FUNCTION public.execute_bulk_unban_atomic(
    p_admin_id UUID,
    p_admin_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_authorized BOOLEAN := FALSE;
    v_restored_count INTEGER := 0;
    v_snap RECORD;
BEGIN
    v_caller_id := auth.uid();
    
    -- Verify authorization
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_caller_id
              AND (role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE)
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk unban.';
    END IF;

    -- Find all active un-restored BULK_BAN snapshot entries
    FOR v_snap IN
        SELECT id, user_id, previous_status, previous_is_banned, previous_is_suspended, previous_ban_reason, previous_banned_at
        FROM public.admin_user_status_snapshots
        WHERE operation_type = 'BULK_BAN'
          AND is_restored IS FALSE
        FOR UPDATE
    LOOP
        -- Restore user profile to exact prior state
        UPDATE public.profiles
        SET status = COALESCE(v_snap.previous_status, 'active'),
            is_banned = COALESCE(v_snap.previous_is_banned, FALSE),
            is_suspended = COALESCE(v_snap.previous_is_suspended, FALSE),
            ban_reason = v_snap.previous_ban_reason,
            banned_at = v_snap.previous_banned_at,
            updated_at = NOW()
        WHERE id = v_snap.user_id;

        -- Mark snapshot as restored
        UPDATE public.admin_user_status_snapshots
        SET is_restored = TRUE,
            restored_at = NOW()
        WHERE id = v_snap.id;

        v_restored_count := v_restored_count + 1;
    END LOOP;

    -- Log audit record
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        p_admin_email,
        'BULK_USERS_UNBANNED',
        'BULK_BAN_RESTORE',
        jsonb_build_object(
            'restored_count', v_restored_count,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'restored_count', v_restored_count,
        'message', format('Successfully restored %s users to their exact pre-ban state. Pre-existing bans were untouched.', v_restored_count)
    );
END;
$$;

-- 5. Atomic Bulk Restrict Function
CREATE OR REPLACE FUNCTION public.execute_bulk_restrict_atomic(
    p_admin_id UUID,
    p_admin_email TEXT,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_authorized BOOLEAN := FALSE;
    v_run_id TEXT;
    v_affected_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_user RECORD;
    v_target_ids UUID[] := ARRAY[]::UUID[];
BEGIN
    v_caller_id := auth.uid();
    
    -- Verify authorization
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_caller_id
              AND (role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE)
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk restrict.';
    END IF;

    -- Generate unique run ID
    v_run_id := 'run_restrict_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(gen_random_uuid()::TEXT, 1, 8);

    -- Loop over candidate non-admin users who are:
    -- 1. Not admin
    -- 2. Not already banned
    -- 3. Not already restricted or suspended
    -- 4. Not already in an un-restored BULK_RESTRICT snapshot
    FOR v_user IN
        SELECT p.id, p.status, p.is_banned, p.is_suspended, p.ban_reason, p.banned_at
        FROM public.profiles p
        WHERE (p.role IS NULL OR p.role != 'admin')
          AND p.is_admin IS NOT TRUE
          AND p.is_admin_account IS NOT TRUE
          AND (p.email IS NULL OR lower(p.email) != 'km8870960@gmail.com')
          AND (p_admin_id IS NULL OR p.id != p_admin_id)
          AND (p.is_banned IS FALSE OR p.is_banned IS NULL)
          AND (p.status IS NULL OR p.status NOT IN ('banned', 'restricted', 'suspended'))
          AND (p.is_suspended IS FALSE OR p.is_suspended IS NULL)
          AND NOT EXISTS (
              SELECT 1 FROM public.admin_user_status_snapshots s
              WHERE s.user_id = p.id
                AND s.operation_type = 'BULK_RESTRICT'
                AND s.is_restored IS FALSE
          )
        FOR UPDATE
    LOOP
        -- 1. Snapshot prior state
        INSERT INTO public.admin_user_status_snapshots (
            operation_type,
            operation_run_id,
            user_id,
            previous_status,
            previous_is_banned,
            previous_is_suspended,
            previous_ban_reason,
            previous_banned_at,
            created_by_admin_id,
            created_by_admin_email,
            is_restored,
            created_at
        ) VALUES (
            'BULK_RESTRICT',
            v_run_id,
            v_user.id,
            COALESCE(v_user.status, 'active'),
            COALESCE(v_user.is_banned, FALSE),
            COALESCE(v_user.is_suspended, FALSE),
            v_user.ban_reason,
            v_user.banned_at,
            p_admin_id,
            p_admin_email,
            FALSE,
            NOW()
        );

        v_target_ids := array_append(v_target_ids, v_user.id);
        v_affected_count := v_affected_count + 1;
    END LOOP;

    -- Count pre-existing restricted/suspended/banned users that were preserved untouched
    SELECT count(*) INTO v_skipped_count
    FROM public.profiles p
    WHERE (p.is_suspended IS TRUE OR p.status IN ('restricted', 'suspended', 'banned') OR p.is_banned IS TRUE)
      AND (p.role IS NULL OR p.role != 'admin')
      AND p.is_admin IS NOT TRUE
      AND p.is_admin_account IS NOT TRUE;

    -- 2. Atomically update eligible target users
    IF v_affected_count > 0 THEN
        UPDATE public.profiles
        SET status = 'restricted',
            is_suspended = TRUE,
            ban_reason = COALESCE(p_reason, 'Global administrator restriction'),
            updated_at = NOW()
        WHERE id = ANY(v_target_ids);
    END IF;

    -- 3. Log audit record
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        p_admin_email,
        'BULK_USERS_RESTRICTED',
        v_run_id,
        jsonb_build_object(
            'run_id', v_run_id,
            'affected_count', v_affected_count,
            'pre_existing_preserved', v_skipped_count,
            'reason', COALESCE(p_reason, 'Global administrator restriction'),
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'run_id', v_run_id,
        'affected_count', v_affected_count,
        'skipped_count', v_skipped_count,
        'message', format('Successfully restricted %s users. %s pre-existing restricted/banned users preserved.', v_affected_count, v_skipped_count)
    );
END;
$$;

-- 6. Atomic Bulk Unrestrict Function
CREATE OR REPLACE FUNCTION public.execute_bulk_unrestrict_atomic(
    p_admin_id UUID,
    p_admin_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_authorized BOOLEAN := FALSE;
    v_restored_count INTEGER := 0;
    v_snap RECORD;
BEGIN
    v_caller_id := auth.uid();
    
    -- Verify authorization
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_caller_id
              AND (role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE)
        ) INTO v_is_authorized;
    END IF;

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk unrestrict.';
    END IF;

    -- Find all active un-restored BULK_RESTRICT snapshot entries
    FOR v_snap IN
        SELECT id, user_id, previous_status, previous_is_banned, previous_is_suspended, previous_ban_reason, previous_banned_at
        FROM public.admin_user_status_snapshots
        WHERE operation_type = 'BULK_RESTRICT'
          AND is_restored IS FALSE
        FOR UPDATE
    LOOP
        -- Restore user profile to exact prior state
        UPDATE public.profiles
        SET status = COALESCE(v_snap.previous_status, 'active'),
            is_banned = COALESCE(v_snap.previous_is_banned, FALSE),
            is_suspended = COALESCE(v_snap.previous_is_suspended, FALSE),
            ban_reason = v_snap.previous_ban_reason,
            banned_at = v_snap.previous_banned_at,
            updated_at = NOW()
        WHERE id = v_snap.user_id;

        -- Mark snapshot as restored
        UPDATE public.admin_user_status_snapshots
        SET is_restored = TRUE,
            restored_at = NOW()
        WHERE id = v_snap.id;

        v_restored_count := v_restored_count + 1;
    END LOOP;

    -- Log audit record
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        p_admin_email,
        'BULK_USERS_UNRESTRICTED',
        'BULK_RESTRICT_RESTORE',
        jsonb_build_object(
            'restored_count', v_restored_count,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'restored_count', v_restored_count,
        'message', format('Successfully restored %s users to their exact pre-restriction state. Pre-existing suspensions were untouched.', v_restored_count)
    );
END;
$$;

-- 7. Revoke execution from PUBLIC / anon and grant to authenticated and service_role
REVOKE ALL ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT) TO authenticated, service_role;
