-- Verify empty search_path on reviewed profile/KYC/trigger SECURITY DEFINER helpers.
DO $profile_trigger_search_path_preflight$
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
      ('public.check_kyc_review_timeout(uuid)', true, ARRAY['FROM public.profiles','UPDATE public.profiles']::text[]),
      ('public.generate_random_username()', true, ARRAY[]::text[]),
      ('public.generate_system_username()', true, ARRAY['FROM public.profiles']::text[]),
      ('public.get_admin_security_status(uuid)', false, ARRAY['auth.role()','public.is_admin()','FROM public.profiles']::text[]),
      ('public.get_user_remaining_buy_allowance(uuid)', true, ARRAY['public.get_user_kyc_tier(','public.get_user_cumulative_buy_volume(']::text[]),
      ('public.handle_new_user_profile()', true, ARRAY['INSERT INTO public.profiles']::text[]),
      ('public.handle_new_user_wallets()', true, ARRAY['FROM public.wallets','INSERT INTO public.profiles']::text[]),
      ('public.handle_new_user()', true, ARRAY[
        'nextval(',
        'public.user_wallet_index_seq',
        'public.generate_system_username()',
        'FROM public.profiles',
        'INSERT INTO public.profiles'
      ]::text[]),
      ('public.handle_profile_status_operation_ownership()', true, ARRAY['current_setting(''app.bulk_status_operation_id'', true)']::text[]),
      ('public.handle_trade_status_sync()', true, ARRAY[]::text[]),
      ('public.handle_trade_volume_update()', true, ARRAY['UPDATE public.profiles']::text[]),
      ('public.prevent_usd_value_at_trade_update()', true, ARRAY[]::text[]),
      ('public.fn_update_user_trade_metrics()', true, ARRAY['UPDATE public.profiles']::text[])
    ) AS targets(signature, service_role_execute, required_refs)
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required function % is missing.', v_target.signature;
    END IF;

    SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.prosrc
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
        RAISE EXCEPTION 'Function % is missing expected dependency fragment %.', v_target.signature, v_required;
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
      RAISE EXCEPTION 'Function % grants differ from the reviewed contract.', v_target.signature;
    END IF;
  END LOOP;
END;
$profile_trigger_search_path_preflight$;
