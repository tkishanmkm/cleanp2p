BEGIN;

DO $trade_dependency_search_path$
DECLARE
  v_target record;
  v_oid oid;
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
BEGIN
  FOR v_target IN
    SELECT *
    FROM (VALUES
      (
        'public.get_user_kyc_tier(uuid)',
        'search_path=public, pg_temp',
        true,
        ARRAY['FROM public.profiles']::text[]
      ),
      (
        'public.get_user_cumulative_buy_volume(uuid)',
        'search_path=public, pg_temp',
        true,
        ARRAY['FROM public.trades']::text[]
      ),
      (
        'public.has_pending_withdrawal_approval(uuid)',
        'search_path=public, auth, pg_temp',
        false,
        ARRAY['FROM public.withdrawals', 'FROM public.onchain_withdrawals']::text[]
      ),
      (
        'public.expire_p2p_trade(uuid)',
        'search_path=public, pg_temp',
        true,
        ARRAY[
          'FROM auth.users',
          'public.is_admin()',
          'FROM public.trades',
          'FROM public.disputes',
          'FROM public.wallet_assets',
          'UPDATE public.wallet_assets',
          'INSERT INTO public.ledger_entries',
          'UPDATE public.trades'
        ]::text[]
      ),
      (
        'public.cancel_expired_p2p_trades()',
        'search_path=public, pg_temp',
        true,
        ARRAY[
          'FROM auth.users',
          'public.is_admin()',
          'FROM public.trades',
          'FROM public.disputes',
          'public.expire_p2p_trade('
        ]::text[]
      )
    ) AS targets(signature, expected_path, service_role_execute, required_refs)
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required trade dependency % is missing; refusing partial hardening.', v_target.signature;
    END IF;

    SELECT
      pg_get_userbyid(p.proowner),
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
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner_before IS DISTINCT FROM 'postgres'
       OR v_definer_before IS DISTINCT FROM TRUE
       OR v_config_before IS DISTINCT FROM ARRAY[v_target.expected_path]::text[] THEN
      RAISE EXCEPTION
        'Function % owner/security/search_path differs from the reviewed production snapshot.',
        v_target.signature;
    END IF;

    -- All non-catalog objects referenced by these five function bodies must be
    -- schema-qualified before their search_path can safely be emptied.
    FOREACH v_required IN ARRAY v_target.required_refs
    LOOP
      IF position(v_required IN v_source_before) = 0 THEN
        RAISE EXCEPTION
          'Function % is missing reviewed qualified dependency fragment %.',
          v_target.signature, v_required;
      END IF;
    END LOOP;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_target.service_role_execute
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS p
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) AS acl
         WHERE p.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Function % execution ACL differs from the reviewed contract.', v_target.signature;
    END IF;

    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO %L',
      v_oid::regprocedure,
      ''
    );

    SELECT
      pg_get_userbyid(p.proowner),
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
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner_after IS DISTINCT FROM v_owner_before
       OR v_definer_after IS DISTINCT FROM v_definer_before
       OR v_acl_after IS DISTINCT FROM v_acl_before
       OR v_source_after IS DISTINCT FROM v_source_before
       OR v_config_after IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION
        'Function % changed body, owner, SECURITY DEFINER or grants, or failed to set an empty search_path.',
        v_target.signature;
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_target.service_role_execute THEN
      RAISE EXCEPTION 'Function % execution grants changed after search_path hardening.', v_target.signature;
    END IF;
  END LOOP;
END;
$trade_dependency_search_path$;

COMMIT;
