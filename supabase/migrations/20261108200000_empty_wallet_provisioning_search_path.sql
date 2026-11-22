-- Pin the active deterministic wallet-provisioning SECURITY DEFINER RPC
-- to an empty search_path. This changes no address derivation or persistence logic.
BEGIN;

DO $wallet_provisioning_search_path$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)'
  );
  v_owner_before text;
  v_definer_before boolean;
  v_config_before text[];
  v_acl_before aclitem[];
  v_source_before text;
  v_owner_after text;
  v_definer_after boolean;
  v_config_after text[];
  v_acl_after aclitem[];
  v_source_after text;
  v_required text;
  v_required_refs text[] := ARRAY[
    'FROM public.profiles',
    'UPDATE public.profiles',
    'FROM public.wallets',
    'INSERT INTO public.wallets',
    'FROM public.user_deposit_addresses',
    'INSERT INTO public.user_deposit_addresses',
    'FROM public.deposit_addresses',
    'INSERT INTO public.deposit_addresses',
    '::public.chain_network',
    'pg_advisory_xact_lock(',
    'hashtext('
  ]::text[];
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Required canonical wallet-provisioning function is missing.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc
  INTO
    v_owner_before,
    v_definer_before,
    v_config_before,
    v_acl_before,
    v_source_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_signature;

  IF v_owner_before IS DISTINCT FROM 'postgres'
     OR v_definer_before IS DISTINCT FROM TRUE
     OR v_config_before IS DISTINCT FROM ARRAY['search_path=public, auth, pg_temp']::text[] THEN
    RAISE EXCEPTION
      'Wallet-provisioning function owner, SECURITY DEFINER flag or existing search_path differs from the reviewed production snapshot.';
  END IF;

  FOREACH v_required IN ARRAY v_required_refs
  LOOP
    IF pg_catalog.strpos(v_source_before, v_required) = 0 THEN
      RAISE EXCEPTION
        'Wallet-provisioning function is missing reviewed schema-qualified dependency fragment: %',
        v_required;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(v_source_before, 'auth.') > 0
     OR v_source_before ~* '\mexecute\M' THEN
    RAISE EXCEPTION
      'Wallet-provisioning function now contains an auth-schema or dynamic-EXECUTE dependency; refusing search_path change.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc p
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) acl
       WHERE p.oid = v_signature
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Wallet-provisioning function execution grants differ from the reviewed service-role-only boundary.';
  END IF;

  EXECUTE $ddl$
    ALTER FUNCTION public.provision_user_wallets_atomic(uuid, integer, text, text, text, text)
      SET search_path TO ''
  $ddl$;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc
  INTO
    v_owner_after,
    v_definer_after,
    v_config_after,
    v_acl_after,
    v_source_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_signature;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_source_after IS DISTINCT FROM v_source_before
     OR v_config_after IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION
      'Wallet-provisioning function body, owner, SECURITY DEFINER status, grants or resulting empty search_path did not match the expected contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Wallet-provisioning function service-role execution boundary changed after search_path hardening.';
  END IF;
END;
$wallet_provisioning_search_path$;

COMMIT;
