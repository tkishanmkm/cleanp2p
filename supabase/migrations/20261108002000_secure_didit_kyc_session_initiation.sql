-- Restore the current secure Didit session initiation RPC expected by the API.
-- The API verifies the human caller with Supabase Auth; this function independently
-- binds cross-user initiation to the durable active administrator identity.
BEGIN;

DO $dependencies$
DECLARE
    v_legacy regprocedure := to_regprocedure('public.initiate_didit_kyc(uuid,text)');
    v_timeout regprocedure := to_regprocedure('public.check_kyc_review_timeout(uuid)');
    v_admin regprocedure := to_regprocedure('public.is_active_admin_identity(uuid)');
BEGIN
    IF v_legacy IS NULL OR v_timeout IS NULL OR v_admin IS NULL THEN
        RAISE EXCEPTION 'Legacy KYC, review-timeout or active-admin dependency is missing';
    END IF;

    IF to_regprocedure('public.initiate_didit_kyc_secure(uuid,text,uuid)') IS NOT NULL THEN
        RAISE EXCEPTION 'Secure Didit initiation RPC already exists; inspect it before replacing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_legacy AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Legacy KYC function must remain postgres-owned and empty-path';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_admin AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Active-admin identity helper must remain postgres-owned and empty-path';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid='public.kyc_verifications'::regclass
          AND i.indisunique AND i.indisvalid
          AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(session_id)%'
    ) THEN
        RAISE EXCEPTION 'Unique KYC session identity index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles'
          AND column_name='kyc_submitted_at'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles'
          AND column_name='didit_session_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='profiles'
          AND column_name='kyc_vendor_session_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='kyc_verifications'
          AND column_name='decision' AND data_type='jsonb'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='kyc_verifications'
          AND column_name='vendor_data' AND data_type='jsonb'
    ) THEN
        RAISE EXCEPTION 'Required profile or KYC verification session fields are missing';
    END IF;
END;
$dependencies$;

-- Timeout state changes are now internal to the postgres-owned initiation
-- functions; the application must use initiate_didit_kyc_secure instead.
ALTER FUNCTION public.check_kyc_review_timeout(uuid)
    SET search_path = '';

REVOKE ALL ON FUNCTION public.check_kyc_review_timeout(uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.check_kyc_review_timeout(uuid) TO postgres;

CREATE OR REPLACE FUNCTION public.initiate_didit_kyc_secure(
    p_user_id uuid,
    p_session_id text,
    p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_attempts integer;
    v_last_attempt timestamptz;
    v_current_status text;
    v_banned boolean;
    v_suspended boolean;
    v_on_hold boolean;
    v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
    -- Only a trusted server may invoke this endpoint. The Next.js API verifies
    -- the user JWT; here we bind the requested target to that verified actor.
    IF coalesce(auth.jwt() ->> 'role','') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL OR p_actor_id IS NULL
       OR p_session_id IS NULL
       OR pg_catalog.btrim(p_session_id) = ''
       OR pg_catalog.length(p_session_id) > 512
       OR p_session_id ~ '[[:cntrl:]]' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','invalid_request'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM auth.users u WHERE u.id=p_actor_id
    ) THEN
        RAISE EXCEPTION 'Verified KYC initiation actor does not exist.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS DISTINCT FROM p_user_id
       AND NOT public.is_active_admin_identity(p_actor_id) THEN
        RAISE EXCEPTION 'Only the target user or a full active administrator may initiate this KYC session.'
            USING ERRCODE = '42501';
    END IF;

    -- Serialize concurrent attempts for the same profile before applying the
    -- 24-hour timeout/reset and retry rules.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('didit-session-registration:' || p_session_id,0)
    );

    PERFORM 1
      FROM public.profiles p
     WHERE p.id=p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','user_not_found'
        );
    END IF;

    PERFORM public.check_kyc_review_timeout(p_user_id);

    SELECT coalesce(p.kyc_attempts,p.kyc_retry_count,0),
           coalesce(p.is_banned,false),
           coalesce(p.is_suspended,false),
           coalesce(p.is_on_hold,false),
           p.kyc_last_attempt_at,
           coalesce(p.kyc_status,'none')
      INTO v_attempts,v_banned,v_suspended,v_on_hold,v_last_attempt,v_current_status
      FROM public.profiles p
     WHERE p.id=p_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','user_not_found'
        );
    END IF;

    IF v_banned OR v_current_status='banned' THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','user_banned'
        );
    END IF;

    IF v_suspended OR v_on_hold THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','account_restricted'
        );
    END IF;

    IF v_last_attempt IS NOT NULL
       AND v_last_attempt < (v_now - interval '24 hours') THEN
        v_attempts := 0;
        UPDATE public.profiles
           SET kyc_attempts=0,
               kyc_retry_count=0,
               updated_at=v_now
         WHERE id=p_user_id;
    END IF;

    IF v_current_status IN ('approved','VERIFIED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','already_verified'
        );
    END IF;

    IF v_current_status IN ('in_review','under_review','PENDING_REVIEW') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,
            'error','already_in_review',
            'message','Your verification is under review. Please wait up to 24 hours.'
        );
    END IF;

    IF v_attempts >= 3
       OR v_current_status IN ('permanently_rejected','SUPPORT_REQUIRED') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,
            'error','max_attempts_exceeded',
            'code','max_attempts_exceeded',
            'message','Maximum KYC attempts (3/3 in 24 hours) exceeded. Please contact support.'
        );
    END IF;

    -- A provider session ID must never be reattached to a different user or
    -- reused after another initiation. The UNIQUE index is the final race guard.
    IF EXISTS (
        SELECT 1 FROM public.kyc_verifications kv
        WHERE kv.session_id=p_session_id
    ) OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.didit_session_id=p_session_id
           OR p.kyc_vendor_session_id=p_session_id
    ) THEN
        RETURN pg_catalog.jsonb_build_object(
            'success',false,'error','session_already_registered'
        );
    END IF;

    UPDATE public.profiles
       SET kyc_status='in_review',
           didit_session_id=p_session_id,
           kyc_vendor_session_id=p_session_id,
           kyc_submitted_at=v_now,
           kyc_attempts=v_attempts+1,
           kyc_retry_count=v_attempts+1,
           kyc_last_attempt_at=v_now,
           updated_at=v_now
     WHERE id=p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'KYC profile could not be updated.'
            USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.kyc_verifications (
        user_id,session_id,status,vendor_data,decision,created_at,updated_at
    ) VALUES (
        p_user_id,
        p_session_id,
        'PENDING_REVIEW',
        pg_catalog.jsonb_build_object('initiated_at',v_now,'attempt',v_attempts+1),
        '{}'::jsonb,
        v_now,
        v_now
    );

    RETURN pg_catalog.jsonb_build_object(
        'success',true,
        'session_id',p_session_id,
        'attempts',v_attempts+1
    );
END;
$function$;

ALTER FUNCTION public.initiate_didit_kyc_secure(uuid,text,uuid)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.initiate_didit_kyc_secure(uuid,text,uuid)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.initiate_didit_kyc_secure(uuid,text,uuid)
    TO service_role, postgres;

COMMENT ON FUNCTION public.initiate_didit_kyc_secure(uuid,text,uuid) IS
    'Trusted-server Didit session initiation. Binds cross-user targets to a durable active administrator, serializes profile retries, enforces 24-hour/three-attempt rules, and atomically registers profile and verification session state.';

NOTIFY pgrst, 'reload schema';

COMMIT;
