BEGIN;

DO $precheck$
BEGIN
  IF to_regprocedure('public.verify_admin_login(uuid,uuid)') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.app_admins') IS NULL THEN
    RAISE EXCEPTION 'Full-admin predicate dependencies are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.verify_admin_login(uuid,uuid)'::regprocedure
      AND p.prosecdef IS TRUE
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'verify_admin_login must remain postgres-owned SECURITY DEFINER with an empty search_path.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_restricted'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_emergency_frozen'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_minor_restricted'
  ) THEN
    RAISE EXCEPTION 'Required active-admin profile safety columns are missing.';
  END IF;
END;
$precheck$;

CREATE OR REPLACE FUNCTION public.is_active_full_admin_actor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.verify_admin_login(p_user_id, NULL) AS verified
       JOIN public.profiles AS p ON p.id = p_user_id
       WHERE verified.is_valid IS TRUE
         AND COALESCE(verified.suspended_val, false) IS FALSE
         AND LOWER(COALESCE(p.status::text, '')) = 'active'
         AND (p.account_status IS NULL OR LOWER(p.account_status) = 'active')
         AND COALESCE(p.is_banned, false) = false
         AND COALESCE(p.is_suspended, false) = false
         AND COALESCE(p.is_restricted, false) = false
         AND COALESCE(p.is_on_hold, false) = false
         AND COALESCE(p.is_emergency_frozen, false) = false
         AND COALESCE(p.is_minor_restricted, false) = false
     );
$function$;

ALTER FUNCTION public.is_active_full_admin_actor(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_full_admin_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_active_full_admin_actor(uuid) TO postgres;

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid='public.is_active_full_admin_actor(uuid)'::regprocedure
      AND p.prosecdef IS TRUE
      AND pg_get_userbyid(p.proowner)='postgres'
      AND p.proconfig @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'Full-admin predicate ownership or search_path postcondition failed.';
  END IF;

  IF has_function_privilege('anon','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR NOT has_function_privilege('postgres','public.is_active_full_admin_actor(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'Full-admin predicate grants do not match the internal-only contract.';
  END IF;
END;
$verify$;

COMMIT;
