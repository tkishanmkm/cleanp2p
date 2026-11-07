-- Retire the legacy Didit KYC status writer.
-- The current webhook handler writes state only through the signed-event claim,
-- apply and finish RPC chain. This older RPC accepts caller-supplied identity and
-- has no session lease, payload digest or event finalization protection.
BEGIN;

DO $dependencies$
DECLARE
    v_legacy regprocedure := to_regprocedure(
        'public.sync_didit_kyc_status(uuid,text,text,jsonb)'
    );
    v_claim regprocedure := to_regprocedure(
        'public.claim_didit_webhook_event(text,text,text)'
    );
    v_finish regprocedure := to_regprocedure(
        'public.finish_didit_webhook_event(text,text,text,uuid,boolean)'
    );
    v_apply regprocedure := to_regprocedure(
        'public.apply_didit_webhook_state(uuid,text,text,text,uuid,jsonb,public.kyc_status_enum,jsonb,jsonb)'
    );
    v_definition text;
    v_caller_count integer;
BEGIN
    IF v_legacy IS NULL OR v_claim IS NULL OR v_finish IS NULL OR v_apply IS NULL THEN
        RAISE EXCEPTION 'Legacy Didit writer or canonical signed-event webhook RPCs are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_legacy
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
    ) THEN
        RAISE EXCEPTION 'Legacy Didit state writer must remain postgres-owned SECURITY DEFINER';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_legacy) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'WHERE id = p_user_id')=0
       OR pg_catalog.strpos(v_definition,'WHERE session_id = p_session_id')=0
       OR pg_catalog.strpos(v_definition,'auth.role()')>0
       OR pg_catalog.strpos(v_definition,'lease_token')>0 THEN
        RAISE EXCEPTION 'Legacy Didit writer body changed; re-audit before retiring it';
    END IF;

    SELECT count(*) INTO v_caller_count
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
    WHERE n.nspname='public'
      AND caller.oid<>v_legacy
      AND position('sync_didit_kyc_status(' in caller.prosrc)>0;

    IF v_caller_count <> 0 THEN
        RAISE EXCEPTION 'Legacy Didit writer has an installed database-function caller; refusing retirement';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role',v_claim,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_finish,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_apply,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical signed-event Didit webhook RPC grants are missing';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid IN (v_claim,v_finish,v_apply)
          AND (
              p.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(p.proowner)<>'postgres'
              OR NOT ('search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[])))
          )
    ) THEN
        RAISE EXCEPTION 'Canonical Didit webhook RPC owner/search_path security contract changed';
    END IF;
END;
$dependencies$;

ALTER FUNCTION public.sync_didit_kyc_status(uuid,text,text,jsonb)
    SET search_path = '';

REVOKE ALL ON FUNCTION public.sync_didit_kyc_status(uuid,text,text,jsonb)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.sync_didit_kyc_status(uuid,text,text,jsonb)
    TO postgres;

COMMENT ON FUNCTION public.sync_didit_kyc_status(uuid,text,text,jsonb) IS
    'Retired legacy Didit KYC writer. Direct application execution is revoked; use claim_didit_webhook_event and apply_didit_webhook_state after verifying the signed provider event and registered session owner.';

NOTIFY pgrst, 'reload schema';

COMMIT;
