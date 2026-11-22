-- Read-only contract checks for atomic advertisement status updates.
DO $ad_status_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.set_ad_status_atomic_authorized(uuid,text,uuid,text,text)');
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'The atomic advertisement status RPC is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=v_oid), false) THEN
    RAISE EXCEPTION 'The ad status RPC must be postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF position('auth.jwt()' IN v_definition) = 0
     OR position('is_active_full_admin_actor' IN v_definition) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0
     OR position('23514' IN v_definition) = 0
     OR position('22023' IN v_definition) = 0
     OR position('ADMIN_AD_STATUS_CHANGE' IN v_definition) = 0
     OR position('PUBLIC_AD_ID' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.P2P_ADS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADS' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'The ad status RPC is missing its auth, row-lock, pair-identity, SELL inventory, mirror or audit contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='public_ad_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='public_ad_id' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'Canonical/legacy ad identity columns do not match the paired-row contract.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Ad status RPC execution must be restricted to service_role.';
  END IF;
END;
$ad_status_preflight$;
