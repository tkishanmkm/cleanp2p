-- Verify empty search_path on the five schema-qualified trade/KYC dependencies.
DO $trade_dependency_search_path_preflight$
DECLARE
  v_target record;
  v_oid oid;
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_source text;
  v_required text;
BEGIN
  FOR v_target IN
    SELECT *
    FROM (VALUES
      ('public.get_user_kyc_tier(uuid)', true, ARRAY['FROM public.profiles']::text[]),
      ('public.get_user_cumulative_buy_volume(uuid)', true, ARRAY['FROM public.trades']::text[]),
      ('public.has_pending_withdrawal_approval(uuid)', false, ARRAY['FROM public.withdrawals', 'FROM public.onchain_withdrawals']::text[]),
      ('public.expire_p2p_trade(uuid)', true, ARRAY[
        'FROM auth.users', 'public.is_admin()', 'FROM public.trades',
        'FROM public.disputes', 'FROM public.wallet_assets',
        'UPDATE public.wallet_assets', 'INSERT INTO public.ledger_entries',
        'UPDATE public.trades'
      ]::text[]),
      ('public.cancel_expired_p2p_trades()', true, ARRAY[
        'FROM auth.users', 'public.is_admin()', 'FROM public.trades',
        'FROM public.disputes', 'public.expire_p2p_trade('
      ]::text[])
    ) AS targets(signature, service_role_execute, required_refs)
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required function % is missing.', v_target.signature;
    END IF;

    SELECT
      pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.proconfig,
      p.prosrc
    INTO v_owner, v_definer, v_config, v_source
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_owner IS DISTINCT FROM 'postgres'
       OR v_definer IS DISTINCT FROM TRUE
       OR v_config IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION 'Function % must be postgres-owned SECURITY DEFINER with empty search_path.', v_target.signature;
    END IF;

    FOREACH v_required IN ARRAY v_target.required_refs
    LOOP
      IF position(v_required IN v_source) = 0 THEN
        RAISE EXCEPTION 'Function % is missing expected schema-qualified reference %.', v_target.signature, v_required;
      END IF;
    END LOOP;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM v_target.service_role_execute
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc p
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) acl
         WHERE p.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Function % grants differ from the reviewed role boundary.', v_target.signature;
    END IF;
  END LOOP;
END;
$trade_dependency_search_path_preflight$;
