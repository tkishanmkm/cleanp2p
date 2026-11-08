-- Read-only post-migration contract for canonical wallet provisioning.
DO $wallet_provisioning_search_path_preflight$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)'
  );
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_source text;
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
    RAISE EXCEPTION 'Canonical wallet-provisioning function is missing.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.prosrc
  INTO v_owner, v_definer, v_config, v_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_signature;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_definer IS DISTINCT FROM TRUE
     OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
    RAISE EXCEPTION
      'Wallet-provisioning function must be postgres-owned SECURITY DEFINER with an empty search_path.';
  END IF;

  FOREACH v_required IN ARRAY v_required_refs
  LOOP
    IF pg_catalog.strpos(v_source, v_required) = 0 THEN
      RAISE EXCEPTION
        'Wallet-provisioning function is missing required qualified dependency fragment: %',
        v_required;
    END IF;
  END LOOP;

  IF pg_catalog.strpos(v_source, 'auth.') > 0
     OR v_source ~* '\mexecute\M' THEN
    RAISE EXCEPTION
      'Wallet-provisioning function has an unapproved auth-schema or dynamic-EXECUTE dependency.';
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
      'Wallet-provisioning function grants must remain service-role-only, with no PUBLIC execute grant.';
  END IF;
END;
$wallet_provisioning_search_path_preflight$;
