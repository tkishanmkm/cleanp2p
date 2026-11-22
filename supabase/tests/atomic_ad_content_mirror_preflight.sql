-- Read-only contract checks for atomic ad content edits.
DO $ad_content_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.update_ad_content_atomic_authorized(uuid,text,uuid,text,jsonb)');
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'The atomic ad content RPC is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=v_oid), false) THEN
    RAISE EXCEPTION 'The ad content RPC must be postgres-owned SECURITY DEFINER with an empty search_path.';
  END IF;

  IF position('AUTH.JWT()' IN upper(v_definition)) = 0
     OR position('SERVICE_ROLE' IN upper(v_definition)) = 0
     OR position('IS_ACTIVE_FULL_ADMIN_ACTOR' IN upper(v_definition)) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0
     OR position('V_IS_ADMIN :=' IN upper(v_definition)) = 0
     OR position('IF V_IS_ADMIN THEN' IN upper(v_definition)) = 0
     OR position('ADMIN_AD_CONTENT_EDIT' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.P2P_ADS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADS' IN upper(v_definition)) = 0
     OR position('JSONB_OBJECT_KEYS' IN upper(v_definition)) = 0
     OR position('IS_DELETED' IN upper(v_definition)) = 0
     OR position('SELL' IN upper(v_definition)) = 0
     OR position('LEGACY ADVERTISEMENT MIRROR IS REQUIRED' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'The ad content RPC is missing trusted execution, admin authorization, row locks, validation, terminal-delete, SELL guard, mirror update, or audit behavior.';
  END IF;

  IF position('AVAILABLE_AMOUNT =' IN upper(v_definition)) > 0
     OR position('TOTAL_AMOUNT =' IN upper(v_definition)) > 0
     OR position('WALLET_BALANCES' IN upper(v_definition)) > 0
     OR position('ESCROW' IN upper(v_definition)) > 0
     OR position('SET STATUS =' IN upper(v_definition)) > 0 THEN
    RAISE EXCEPTION 'The ad content RPC must not mutate inventory, wallet, escrow or advertisement lifecycle status.';
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
    RAISE EXCEPTION 'Ad content RPC execution must be restricted to service_role and postgres.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p2p_ads'
      AND column_name='payment_methods' AND data_type='jsonb'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='payment_methods' AND data_type='ARRAY'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ads'
      AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'Canonical/legacy ad content column types do not match the RPC contract.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid = v_oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC must not execute the ad content RPC.';
  END IF;
END;
$ad_content_preflight$;
