-- Read-only schema, ACL and RLS preflight for trade/admin registry restoration.
DO $preflight$
DECLARE
  v_table regclass;
  v_oid oid;
  v_config text[];
  v_owner text;
  v_definer boolean;
  v_definition text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.trade_system_events'::regclass,
    'public.trade_chat_limit_requests'::regclass
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=v_table) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %',v_table;
    END IF;
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=v_table)) <> 'postgres' THEN
      RAISE EXCEPTION 'FAIL: % is not postgres-owned',v_table;
    END IF;
    IF NOT has_table_privilege('service_role',v_table,'SELECT')
       OR NOT has_table_privilege('service_role',v_table,'INSERT')
       OR NOT has_table_privilege('service_role',v_table,'UPDATE')
       OR NOT has_table_privilege('service_role',v_table,'DELETE') THEN
      RAISE EXCEPTION 'FAIL: service_role table access is incomplete for %',v_table;
    END IF;
    IF has_table_privilege('anon',v_table,'SELECT')
       OR has_table_privilege('anon',v_table,'INSERT')
       OR has_table_privilege('anon',v_table,'UPDATE')
       OR has_table_privilege('anon',v_table,'DELETE')
       OR has_table_privilege('authenticated',v_table,'SELECT')
       OR has_table_privilege('authenticated',v_table,'INSERT')
       OR has_table_privilege('authenticated',v_table,'UPDATE')
       OR has_table_privilege('authenticated',v_table,'DELETE') THEN
      RAISE EXCEPTION 'FAIL: browser role has direct access to %',v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.trade_system_events'::regclass
      AND conname='trade_system_events_trade_dedupe_key'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'FAIL: trade-system idempotency key is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.trade_chat_limit_requests'::regclass
      AND conname='trade_chat_limit_requests_one_per_user_trade'
      AND contype='u'
  ) THEN
    RAISE EXCEPTION 'FAIL: chat-limit request idempotency key is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND schemaname='public'
      AND tablename='trade_system_events'
  ) THEN
    RAISE EXCEPTION 'FAIL: trade_system_events must not be published to Realtime';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.platform_wallets'::regclass,
    'public.crypto_deposit_addresses'::regclass
  ] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=v_table) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %',v_table;
    END IF;
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid=v_table)) <> 'postgres' THEN
      RAISE EXCEPTION 'FAIL: % is not postgres-owned',v_table;
    END IF;
    IF NOT has_table_privilege('service_role',v_table,'SELECT')
       OR NOT has_table_privilege('service_role',v_table,'INSERT')
       OR NOT has_table_privilege('service_role',v_table,'UPDATE')
       OR NOT has_table_privilege('service_role',v_table,'DELETE') THEN
      RAISE EXCEPTION 'FAIL: service_role table access is incomplete for %',v_table;
    END IF;
    IF has_table_privilege('anon',v_table,'SELECT')
       OR has_table_privilege('anon',v_table,'INSERT')
       OR has_table_privilege('anon',v_table,'UPDATE')
       OR has_table_privilege('anon',v_table,'DELETE') THEN
      RAISE EXCEPTION 'FAIL: anon has direct access to %',v_table;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated','platform_wallets','INSERT')
     OR has_table_privilege('authenticated','platform_wallets','UPDATE')
     OR has_table_privilege('authenticated','platform_wallets','DELETE')
     OR NOT has_table_privilege('authenticated','platform_wallets','SELECT') THEN
    RAISE EXCEPTION 'FAIL: platform_wallets must be authenticated read-only';
  END IF;
  IF NOT has_table_privilege('authenticated','crypto_deposit_addresses','SELECT')
     OR NOT has_table_privilege('authenticated','crypto_deposit_addresses','INSERT')
     OR NOT has_table_privilege('authenticated','crypto_deposit_addresses','UPDATE')
     OR NOT has_table_privilege('authenticated','crypto_deposit_addresses','DELETE') THEN
    RAISE EXCEPTION 'FAIL: authenticated admin registry CRUD grants are missing';
  END IF;

  v_oid := to_regprocedure('public.is_active_full_admin_for_current_user()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'FAIL: current-user full-admin RLS helper is missing';
  END IF;
  SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner)
    INTO v_definer,v_config,v_owner
    FROM pg_proc p WHERE p.oid=v_oid;
  IF v_definer IS DISTINCT FROM TRUE OR v_owner <> 'postgres'
     OR NOT ('search_path=""'=ANY(COALESCE(v_config,ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'FAIL: current-user RLS helper must be postgres-owned SECURITY DEFINER with empty search_path';
  END IF;
  IF NOT has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR has_function_privilege('anon',v_oid,'EXECUTE')
     OR has_function_privilege('service_role',v_oid,'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
       WHERE p.oid=v_oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'FAIL: current-user RLS helper EXECUTE grants are not restricted to authenticated/postgres';
  END IF;

  SELECT lower(qual) INTO v_definition
  FROM pg_policies
  WHERE schemaname='public' AND tablename='platform_wallets'
    AND policyname='platform_wallets_admin_read' AND cmd='SELECT';
  IF v_definition IS NULL OR strpos(v_definition,'is_active_full_admin_for_current_user')=0 THEN
    RAISE EXCEPTION 'FAIL: platform wallet RLS policy does not require an active full admin';
  END IF;
  SELECT lower(qual || ' ' || with_check) INTO v_definition
  FROM pg_policies
  WHERE schemaname='public' AND tablename='crypto_deposit_addresses'
    AND policyname='crypto_deposit_address_sets_admin_all' AND cmd='ALL';
  IF v_definition IS NULL OR strpos(v_definition,'is_active_full_admin_for_current_user')=0 THEN
    RAISE EXCEPTION 'FAIL: rotating deposit-address write policy does not require an active full admin';
  END IF;

  RAISE NOTICE 'PASS: server-only trade/chat tables and admin-only wallet/address registries have the expected RLS, grants, idempotency keys and Realtime boundary.';
END;
$preflight$;
