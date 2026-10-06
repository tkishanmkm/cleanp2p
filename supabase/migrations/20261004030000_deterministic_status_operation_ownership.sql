-- Migration: 20261004030000_deterministic_status_operation_ownership.sql
-- Description: Deterministic per-profile status operation ownership token and automated
--              invalidation trigger. Guarantees that any manual administrator change
--              (even with identical status/flags/reason) invalidates bulk ownership
--              and is never overwritten by subsequent bulk unban or unrestrict operations.

-- 1. Add status_operation_id column to public.profiles if not exists
ALTER TABLE IF EXISTS public.profiles
    ADD COLUMN IF NOT EXISTS status_operation_id TEXT;

-- 2. Enhance admin_user_status_snapshots table if not already enhanced
ALTER TABLE IF EXISTS public.admin_user_status_snapshots
    ADD COLUMN IF NOT EXISTS applied_status TEXT,
    ADD COLUMN IF NOT EXISTS applied_is_banned BOOLEAN,
    ADD COLUMN IF NOT EXISTS applied_is_suspended BOOLEAN,
    ADD COLUMN IF NOT EXISTS applied_ban_reason TEXT,
    ADD COLUMN IF NOT EXISTS conflict_detected BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS conflict_reason TEXT;

-- 3. Ensure database-level unique partial index for active snapshots exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_user_status_snapshot 
    ON public.admin_user_status_snapshots (user_id, operation_type) 
    WHERE is_restored IS FALSE;

-- 4. Database Trigger: Invalidate bulk status_operation_id on any manual or external status change
CREATE OR REPLACE FUNCTION public.handle_profile_status_operation_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- If any status lifecycle field is modified:
    IF (
        OLD.status IS DISTINCT FROM NEW.status OR
        OLD.is_banned IS DISTINCT FROM NEW.is_banned OR
        OLD.is_suspended IS DISTINCT FROM NEW.is_suspended OR
        OLD.ban_reason IS DISTINCT FROM NEW.ban_reason
    ) THEN
        -- If the update did not explicitly assign a new/different status_operation_id,
        -- invalidate any existing bulk operation ownership token immediately!
        IF NEW.status_operation_id IS NOT DISTINCT FROM OLD.status_operation_id THEN
            NEW.status_operation_id := NULL;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_status_operation_ownership ON public.profiles;

CREATE TRIGGER trg_profile_status_operation_ownership
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_profile_status_operation_ownership();

-- 5. Deterministic Atomic Bulk Ban Function
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
    v_authoritative_admin_id UUID;
    v_authoritative_admin_email TEXT;
    v_run_id TEXT;
    v_affected_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_user RECORD;
    v_target_ids UUID[] := ARRAY[]::UUID[];
    v_applied_reason TEXT;
BEGIN
    v_caller_id := auth.uid();
    
    -- Dynamic Authoritative Administrator Identity Verification
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
        v_authoritative_admin_id := p_admin_id;
        v_authoritative_admin_email := COALESCE(p_admin_email, 'service_role@paxones.internal');
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT 
            TRUE,
            p.id,
            COALESCE(p.email, p_admin_email, 'admin@paxones.com')
        INTO 
            v_is_authorized,
            v_authoritative_admin_id,
            v_authoritative_admin_email
        FROM public.profiles p
        WHERE p.id = v_caller_id
          AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE);
    END IF;

    IF v_is_authorized IS NOT TRUE THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk ban.';
    END IF;

    v_applied_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Global administrator administrative ban');
    v_run_id := 'run_ban_' || to_char(NOW(), 'YYYYMMDD_HH24MISS') || '_' || substr(gen_random_uuid()::TEXT, 1, 8);

    -- Loop over candidate non-admin users who are not currently banned
    -- and do not already have an active un-restored BULK_BAN snapshot
    FOR v_user IN
        SELECT p.id, p.status, p.is_banned, p.is_suspended, p.ban_reason, p.banned_at
        FROM public.profiles p
        WHERE (p.role IS NULL OR p.role != 'admin')
          AND p.is_admin IS NOT TRUE
          AND p.is_admin_account IS NOT TRUE
          AND (v_authoritative_admin_id IS NULL OR p.id != v_authoritative_admin_id)
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
        -- 1. Snapshot prior state and record applied operation details
        INSERT INTO public.admin_user_status_snapshots (
            operation_type,
            operation_run_id,
            user_id,
            previous_status,
            previous_is_banned,
            previous_is_suspended,
            previous_ban_reason,
            previous_banned_at,
            applied_status,
            applied_is_banned,
            applied_is_suspended,
            applied_ban_reason,
            conflict_detected,
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
            'banned',
            TRUE,
            COALESCE(v_user.is_suspended, FALSE),
            v_applied_reason,
            FALSE,
            v_authoritative_admin_id,
            v_authoritative_admin_email,
            FALSE,
            NOW()
        );

        v_target_ids := array_append(v_target_ids, v_user.id);
        v_affected_count := v_affected_count + 1;
    END LOOP;

    -- Count pre-existing banned users that were skipped and preserved untouched
    SELECT count(*) INTO v_skipped_count
    FROM public.profiles p
    WHERE (p.is_banned IS TRUE OR p.status = 'banned')
      AND (p.role IS NULL OR p.role != 'admin')
      AND p.is_admin IS NOT TRUE
      AND p.is_admin_account IS NOT TRUE
      AND (v_authoritative_admin_id IS NULL OR p.id != v_authoritative_admin_id);

    -- 2. Atomically update eligible target users with deterministic status_operation_id
    IF v_affected_count > 0 THEN
        UPDATE public.profiles
        SET status = 'banned',
            is_banned = TRUE,
            ban_reason = v_applied_reason,
            banned_at = NOW(),
            status_operation_id = v_run_id,
            updated_at = NOW()
        WHERE id = ANY(v_target_ids);
    END IF;

    -- 3. Log audit record with authoritative admin identity
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        details,
        created_at
    ) VALUES (
        v_authoritative_admin_id,
        v_authoritative_admin_email,
        'BULK_USERS_BANNED',
        v_run_id,
        jsonb_build_object(
            'operation', 'BULK_BAN',
            'operation_run_id', v_run_id,
            'affected_count', v_affected_count,
            'skipped_count', v_skipped_count,
            'reason', v_applied_reason,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'operation', 'BULK_BAN',
        'operation_run_id', v_run_id,
        'affected_count', v_affected_count,
        'skipped_count', v_skipped_count,
        'conflict_count', 0,
        'message', format('Successfully banned %s users. %s pre-existing banned users preserved untouched.', v_affected_count, v_skipped_count)
    );
END;
$$;

-- 6. Deterministic Atomic Bulk Unban Function
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
    v_authoritative_admin_id UUID;
    v_authoritative_admin_email TEXT;
    v_restored_count INTEGER := 0;
    v_conflict_count INTEGER := 0;
    v_snap RECORD;
    v_curr_prof RECORD;
    v_is_owned_and_matching BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    
    -- Dynamic Authoritative Administrator Identity Verification
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
        v_authoritative_admin_id := p_admin_id;
        v_authoritative_admin_email := COALESCE(p_admin_email, 'service_role@paxones.internal');
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT 
            TRUE,
            p.id,
            COALESCE(p.email, p_admin_email, 'admin@paxones.com')
        INTO 
            v_is_authorized,
            v_authoritative_admin_id,
            v_authoritative_admin_email
        FROM public.profiles p
        WHERE p.id = v_caller_id
          AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE);
    END IF;

    IF v_is_authorized IS NOT TRUE THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk unban.';
    END IF;

    -- Find all active un-restored BULK_BAN snapshot entries
    FOR v_snap IN
        SELECT 
            s.id, 
            s.operation_run_id,
            s.user_id, 
            s.previous_status, 
            s.previous_is_banned, 
            s.previous_is_suspended, 
            s.previous_ban_reason, 
            s.previous_banned_at,
            s.applied_ban_reason
        FROM public.admin_user_status_snapshots s
        WHERE s.operation_type = 'BULK_BAN'
          AND s.is_restored IS FALSE
        FOR UPDATE
    LOOP
        -- Fetch current profile state with row lock
        SELECT p.id, p.status, p.is_banned, p.is_suspended, p.ban_reason, p.banned_at, p.status_operation_id
        INTO v_curr_prof
        FROM public.profiles p
        WHERE p.id = v_snap.user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            -- Profile was deleted; mark snapshot as resolved/conflict
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = TRUE,
                conflict_reason = 'User profile was deleted prior to unban'
            WHERE id = v_snap.id;
            
            v_conflict_count := v_conflict_count + 1;
            CONTINUE;
        END IF;

        -- DETERMINISTIC OPERATION OWNERSHIP CHECK:
        -- The profile MUST still possess the exact status_operation_id assigned by this specific bulk run,
        -- AND the status must still be 'banned' and is_banned = TRUE.
        -- Any subsequent manual admin change (even if with identical ban reason/flags) cleared
        -- status_operation_id to NULL, preventing accidental restoration.
        v_is_owned_and_matching := (
            v_curr_prof.status_operation_id IS NOT NULL
            AND v_curr_prof.status_operation_id = v_snap.operation_run_id
            AND v_curr_prof.is_banned IS TRUE 
            AND v_curr_prof.status = 'banned'
        );

        IF v_is_owned_and_matching THEN
            -- Safe to restore user profile to exact prior state
            UPDATE public.profiles
            SET status = COALESCE(v_snap.previous_status, 'active'),
                is_banned = COALESCE(v_snap.previous_is_banned, FALSE),
                is_suspended = COALESCE(v_snap.previous_is_suspended, FALSE),
                ban_reason = v_snap.previous_ban_reason,
                banned_at = v_snap.previous_banned_at,
                status_operation_id = NULL,
                updated_at = NOW()
            WHERE id = v_snap.user_id;

            -- Mark snapshot as successfully restored
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = FALSE
            WHERE id = v_snap.id;

            v_restored_count := v_restored_count + 1;
        ELSE
            -- Conflict detected: User state was modified after bulk ban.
            -- Leave the user profile untouched to protect manual admin decisions.
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = TRUE,
                conflict_reason = format('Operation ownership mismatch or manual modification (current token: %s, expected: %s, current status: %s, is_banned: %s)', v_curr_prof.status_operation_id, v_snap.operation_run_id, v_curr_prof.status, v_curr_prof.is_banned)
            WHERE id = v_snap.id;

            v_conflict_count := v_conflict_count + 1;
        END IF;
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
        v_authoritative_admin_id,
        v_authoritative_admin_email,
        'BULK_USERS_UNBANNED',
        'BULK_BAN_RESTORE',
        jsonb_build_object(
            'operation', 'BULK_UNBAN',
            'restored_count', v_restored_count,
            'conflict_count', v_conflict_count,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'operation', 'BULK_UNBAN',
        'restored_count', v_restored_count,
        'conflict_count', v_conflict_count,
        'message', format('Successfully restored %s users to their pre-ban state. %s conflicting/modified accounts preserved untouched.', v_restored_count, v_conflict_count)
    );
END;
$$;

-- 7. Deterministic Atomic Bulk Restrict Function
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
    v_authoritative_admin_id UUID;
    v_authoritative_admin_email TEXT;
    v_run_id TEXT;
    v_affected_count INTEGER := 0;
    v_skipped_count INTEGER := 0;
    v_user RECORD;
    v_target_ids UUID[] := ARRAY[]::UUID[];
    v_applied_reason TEXT;
BEGIN
    v_caller_id := auth.uid();
    
    -- Dynamic Authoritative Administrator Identity Verification
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
        v_authoritative_admin_id := p_admin_id;
        v_authoritative_admin_email := COALESCE(p_admin_email, 'service_role@paxones.internal');
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT 
            TRUE,
            p.id,
            COALESCE(p.email, p_admin_email, 'admin@paxones.com')
        INTO 
            v_is_authorized,
            v_authoritative_admin_id,
            v_authoritative_admin_email
        FROM public.profiles p
        WHERE p.id = v_caller_id
          AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE);
    END IF;

    IF v_is_authorized IS NOT TRUE THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk restrict.';
    END IF;

    v_applied_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Global administrator restriction');
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
          AND (v_authoritative_admin_id IS NULL OR p.id != v_authoritative_admin_id)
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
        -- 1. Snapshot prior state and record applied operation details
        INSERT INTO public.admin_user_status_snapshots (
            operation_type,
            operation_run_id,
            user_id,
            previous_status,
            previous_is_banned,
            previous_is_suspended,
            previous_ban_reason,
            previous_banned_at,
            applied_status,
            applied_is_banned,
            applied_is_suspended,
            applied_ban_reason,
            conflict_detected,
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
            'restricted',
            COALESCE(v_user.is_banned, FALSE),
            TRUE,
            v_applied_reason,
            FALSE,
            v_authoritative_admin_id,
            v_authoritative_admin_email,
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
      AND p.is_admin_account IS NOT TRUE
      AND (v_authoritative_admin_id IS NULL OR p.id != v_authoritative_admin_id);

    -- 2. Atomically update eligible target users with deterministic status_operation_id
    IF v_affected_count > 0 THEN
        UPDATE public.profiles
        SET status = 'restricted',
            is_suspended = TRUE,
            ban_reason = v_applied_reason,
            status_operation_id = v_run_id,
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
        v_authoritative_admin_id,
        v_authoritative_admin_email,
        'BULK_USERS_RESTRICTED',
        v_run_id,
        jsonb_build_object(
            'operation', 'BULK_RESTRICT',
            'operation_run_id', v_run_id,
            'affected_count', v_affected_count,
            'skipped_count', v_skipped_count,
            'reason', v_applied_reason,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'operation', 'BULK_RESTRICT',
        'operation_run_id', v_run_id,
        'affected_count', v_affected_count,
        'skipped_count', v_skipped_count,
        'conflict_count', 0,
        'message', format('Successfully restricted %s users. %s pre-existing restricted/banned accounts preserved untouched.', v_affected_count, v_skipped_count)
    );
END;
$$;

-- 8. Deterministic Atomic Bulk Unrestrict Function
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
    v_authoritative_admin_id UUID;
    v_authoritative_admin_email TEXT;
    v_restored_count INTEGER := 0;
    v_conflict_count INTEGER := 0;
    v_snap RECORD;
    v_curr_prof RECORD;
    v_is_owned_and_matching BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    
    -- Dynamic Authoritative Administrator Identity Verification
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_is_authorized := TRUE;
        v_authoritative_admin_id := p_admin_id;
        v_authoritative_admin_email := COALESCE(p_admin_email, 'service_role@paxones.internal');
    ELSIF v_caller_id IS NOT NULL THEN
        SELECT 
            TRUE,
            p.id,
            COALESCE(p.email, p_admin_email, 'admin@paxones.com')
        INTO 
            v_is_authorized,
            v_authoritative_admin_id,
            v_authoritative_admin_email
        FROM public.profiles p
        WHERE p.id = v_caller_id
          AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE);
    END IF;

    IF v_is_authorized IS NOT TRUE THEN
        RAISE EXCEPTION 'Unauthorized: Administrator privileges required to execute bulk unrestrict.';
    END IF;

    -- Find all active un-restored BULK_RESTRICT snapshot entries
    FOR v_snap IN
        SELECT 
            s.id, 
            s.operation_run_id,
            s.user_id, 
            s.previous_status, 
            s.previous_is_banned, 
            s.previous_is_suspended, 
            s.previous_ban_reason, 
            s.previous_banned_at,
            s.applied_ban_reason
        FROM public.admin_user_status_snapshots s
        WHERE s.operation_type = 'BULK_RESTRICT'
          AND s.is_restored IS FALSE
        FOR UPDATE
    LOOP
        -- Fetch current profile state with row lock
        SELECT p.id, p.status, p.is_banned, p.is_suspended, p.ban_reason, p.banned_at, p.status_operation_id
        INTO v_curr_prof
        FROM public.profiles p
        WHERE p.id = v_snap.user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            -- Profile was deleted; mark snapshot as restored
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = TRUE,
                conflict_reason = 'User profile was deleted prior to unrestrict'
            WHERE id = v_snap.id;
            
            v_conflict_count := v_conflict_count + 1;
            CONTINUE;
        END IF;

        -- DETERMINISTIC OPERATION OWNERSHIP CHECK:
        -- The profile MUST still possess the exact status_operation_id assigned by this bulk restrict run,
        -- AND the user must still be restricted and suspended without a ban.
        -- Any subsequent manual change or subsequent bulk ban updated/cleared status_operation_id!
        v_is_owned_and_matching := (
            v_curr_prof.status_operation_id IS NOT NULL
            AND v_curr_prof.status_operation_id = v_snap.operation_run_id
            AND (v_curr_prof.is_banned IS FALSE OR v_curr_prof.is_banned IS NULL)
            AND v_curr_prof.is_suspended IS TRUE
            AND v_curr_prof.status = 'restricted'
        );

        IF v_is_owned_and_matching THEN
            -- Safe to restore user profile to exact prior state
            UPDATE public.profiles
            SET status = COALESCE(v_snap.previous_status, 'active'),
                is_banned = COALESCE(v_snap.previous_is_banned, FALSE),
                is_suspended = COALESCE(v_snap.previous_is_suspended, FALSE),
                ban_reason = v_snap.previous_ban_reason,
                banned_at = v_snap.previous_banned_at,
                status_operation_id = NULL,
                updated_at = NOW()
            WHERE id = v_snap.user_id;

            -- Mark snapshot as restored
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = FALSE
            WHERE id = v_snap.id;

            v_restored_count := v_restored_count + 1;
        ELSE
            -- Conflict detected: User was banned, un-suspended, or manually altered.
            -- Leave the current profile state completely intact.
            UPDATE public.admin_user_status_snapshots
            SET is_restored = TRUE,
                restored_at = NOW(),
                conflict_detected = TRUE,
                conflict_reason = format('Operation ownership mismatch or superseded (current token: %s, expected: %s, current status: %s, is_banned: %s, is_suspended: %s)', v_curr_prof.status_operation_id, v_snap.operation_run_id, v_curr_prof.status, v_curr_prof.is_banned, v_curr_prof.is_suspended)
            WHERE id = v_snap.id;

            v_conflict_count := v_conflict_count + 1;
        END IF;
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
        v_authoritative_admin_id,
        v_authoritative_admin_email,
        'BULK_USERS_UNRESTRICTED',
        'BULK_RESTRICT_RESTORE',
        jsonb_build_object(
            'operation', 'BULK_UNRESTRICT',
            'restored_count', v_restored_count,
            'conflict_count', v_conflict_count,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'operation', 'BULK_UNRESTRICT',
        'restored_count', v_restored_count,
        'conflict_count', v_conflict_count,
        'message', format('Successfully restored %s users to their pre-restriction state. %s conflicting/superseded accounts preserved untouched.', v_restored_count, v_conflict_count)
    );
END;
$$;

-- 9. Grant execution permissions
REVOKE ALL ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT) TO authenticated, service_role;
