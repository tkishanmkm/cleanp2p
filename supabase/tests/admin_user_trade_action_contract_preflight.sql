-- Read-only preflight for server-only admin user/trade action RPC restoration.
-- It checks DDL contracts and ACLs only; it does not invoke payment/escrow functions.
DO $preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_config text[];
  v_definer boolean;
  v_definition text;
  v_functions text[] := ARRAY[
    'public.admin_update_user_role_authorized(uuid,text,uuid,text)',
    'public.admin_update_user_status_authorized(uuid,text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)',
    'public.admin_freeze_user_authorized(uuid,text,uuid,text)',
    'public.admin_unfreeze_user_authorized(uuid,text,uuid,text)',
    'public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)',
    'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid=e.enumtypid
    JOIN pg_namespace n ON n.oid=t.typnamespace
    WHERE n.nspname='public' AND t.typname='user_status_enum' AND e.enumlabel='restricted'
  ) THEN
    RAISE EXCEPTION 'FAIL: restricted user status enum label is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_admins' AND column_name='user_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_admins' AND column_name='granted_at'
  ) THEN
    RAISE EXCEPTION 'FAIL: deployed app_admins registry columns are not present';
  END IF;

  FOREACH v_signature IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: required admin RPC % is missing', v_signature;
    END IF;
    SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)
      INTO v_definer, v_config, v_owner
      FROM pg_proc p WHERE p.oid=v_oid;
    IF v_definer IS DISTINCT FROM TRUE OR v_owner <> 'postgres'
       OR NOT ('search_path=""'=ANY(COALESCE(v_config,ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'FAIL: % must be postgres-owned SECURITY DEFINER with empty search_path',v_signature;
    END IF;
    IF has_function_privilege('anon',v_oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
         WHERE p.oid=v_oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'FAIL: % is executable by PUBLIC/anon/authenticated',v_signature;
    END IF;
    IF NOT has_function_privilege('service_role',v_oid,'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role cannot execute %',v_signature;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('postgres','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.is_active_full_admin_actor(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.is_active_full_admin_actor(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: strict full-admin helper must remain internal to postgres-owned wrappers';
  END IF;

  SELECT lower(pg_get_functiondef('public.admin_update_user_role_authorized(uuid,text,uuid,text)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'is_active_full_admin_actor')=0
     OR strpos(v_definition,'pg_advisory_xact_lock')=0
     OR strpos(v_definition,'last active administrator cannot be demoted')=0
     OR strpos(v_definition,'insert into public.app_admins (user_id, granted_at)')=0
     OR strpos(v_definition,'app_admins.role')>0
     OR strpos(v_definition,'app_admins.created_at')>0
     OR strpos(v_definition,'support_admin_emergency_sessions')=0 THEN
    RAISE EXCEPTION 'FAIL: admin role function lacks strict actor, last-admin lock or deployed registry/session contract';
  END IF;

  SELECT lower(pg_get_functiondef('public.admin_update_user_status_authorized(uuid,text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'is_active_full_admin_actor')=0
     OR strpos(v_definition,'account_status')=0
     OR strpos(v_definition,'suspension_reason')=0
     OR strpos(v_definition,'demote a full administrator')=0
     OR strpos(v_definition,'support_admin_emergency_sessions')=0
     OR strpos(v_definition,'public.advertisements')=0
     OR strpos(v_definition,'public.ads')=0
     OR strpos(v_definition,'public.p2p_ads')=0 THEN
    RAISE EXCEPTION 'FAIL: admin status function is missing full-admin, account-state or side-effect guards';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_freeze_user_authorized(uuid,text,uuid,text)',
    'public.admin_unfreeze_user_authorized(uuid,text,uuid,text)'
  ] LOOP
    SELECT lower(pg_get_functiondef(to_regprocedure(v_signature))) INTO v_definition;
    IF strpos(v_definition,'is_active_full_admin_actor')=0
       OR strpos(v_definition,'support_admin_emergency_sessions')=0 THEN
      RAISE EXCEPTION 'FAIL: % lacks full-admin actor binding or support emergency-session invalidation',v_signature;
    END IF;
    IF v_signature = 'public.admin_freeze_user_authorized(uuid,text,uuid,text)'
       AND (
         strpos(v_definition,'public.advertisements')=0
         OR strpos(v_definition,'public.ads')=0
         OR strpos(v_definition,'public.p2p_ads')=0
       ) THEN
      RAISE EXCEPTION 'FAIL: emergency freeze does not pause offers in all marketplace tables';
    END IF;
    IF v_signature = 'public.admin_unfreeze_user_authorized(uuid,text,uuid,text)'
       AND (
         strpos(v_definition,'public.ads')>0
         OR strpos(v_definition,'public.p2p_ads')>0
         OR strpos(v_definition,'active=true')>0
         OR strpos(v_definition,'is_active=true')>0
       ) THEN
      RAISE EXCEPTION 'FAIL: unfreeze must not automatically reactivate marketplace offers';
    END IF;
  END LOOP;

  SELECT lower(pg_get_functiondef('public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'is_active_full_admin_actor')=0
     OR strpos(v_definition,'public.mark_p2p_trade_paid')=0
     OR strpos(v_definition,'admin_marked_trade_paid')=0
     OR strpos(v_definition,'public.admin_audit_logs')=0
     OR strpos(v_definition,'v_clean_reason')=0 THEN
    RAISE EXCEPTION 'FAIL: mark-paid wrapper lacks strict actor, canonical transition or mandatory audit';
  END IF;

  SELECT lower(pg_get_functiondef('public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition,'is_active_full_admin_actor')=0
     OR strpos(v_definition,'public.resolve_trade_dispute')=0
     OR strpos(v_definition,'admin_resolved_trade_dispute')=0
     OR strpos(v_definition,'public.admin_audit_logs')=0
     OR strpos(v_definition,'exactly one open dispute')=0
     OR strpos(v_definition,'p_winner_id')=0 THEN
    RAISE EXCEPTION 'FAIL: dispute wrapper lacks full-admin actor, canonical resolver, winner/open-dispute guards or audit';
  END IF;

  IF has_function_privilege('service_role','public.resolve_trade_dispute(uuid,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.resolve_trade_dispute(uuid,text,uuid,uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.resolve_trade_dispute(uuid,text,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('postgres','public.resolve_trade_dispute(uuid,text,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: inner dispute resolver must be callable only by its postgres-owned wrapper';
  END IF;

  IF has_function_privilege('service_role','public.admin_update_user_role(uuid,uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.admin_update_user_status(text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum)','EXECUTE')
     OR has_function_privilege('service_role','public.admin_freeze_user(uuid,text)','EXECUTE')
     OR has_function_privilege('service_role','public.admin_unfreeze_user(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: legacy direct admin mutation RPCs remain service-role executable';
  END IF;

  IF NOT has_function_privilege('service_role','public.mark_p2p_trade_paid(uuid,uuid,text)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.release_trade_escrow(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.cancel_p2p_trade(uuid,uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: one or more canonical participant/escrow RPC dependencies are missing';
  END IF;

  RAISE NOTICE 'PASS: admin user/trade RPCs have strict full-admin identity, atomic audit, server-only ACLs and preserved canonical transaction dependencies. This preflight does not exercise any financial operation.';
END;
$preflight$;
