-- Empty search_path for reviewed profile/KYC/trigger SECURITY DEFINER helpers.
-- This batch changes only function configuration; it does not replace function bodies.
BEGIN;

DO $profile_trigger_search_paths$
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
        'public.check_kyc_review_timeout(uuid)',
        'search_path=public, pg_temp',
        true,
        ARRAY['FROM public.profiles', 'UPDATE public.profiles']::text[]
      ),
      (
        'public.generate_random_username()',
        'search_path=public, pg_temp',
        true,
        ARRAY[]::text[]
      ),
      (
        'public.generate_system_username()',
        'search_path=public, pg_temp',
        true,
        ARRAY['FROM public.profiles']::text[]
      ),
      (
        'public.get_admin_security_status(uuid)',
        'search_path=public, pg_temp',
        false,
        ARRAY['auth.role()', 'public.is_admin()', 'FROM public.profiles']::text[]
      ),
      (
        'public.get_user_remaining_buy_allowance(uuid)',
        'search_path=public, pg_temp',
        true,
        ARRAY['public.get_user_kyc_tier(', 'public.get_user_cumulative_buy_volume(']::text[]
      ),
      (
        'public.handle_new_user_profile()',
        'search_path=public',
        true,
        ARRAY['INSERT INTO public.profiles']::text[]
      ),
      (
        'public.handle_new_user_wallets()',
        'search_path=public, pg_temp',
        true,
        ARRAY['FROM public.wallets', 'INSERT INTO public.profiles']::text[]
      ),
      (
        'public.handle_new_user()',
        'search_path=public, auth, pg_temp',
        true,
        ARRAY[
          'nextval(',
          'public.user_wallet_index_seq',
          'public.generate_system_username()',
          'FROM public.profiles',
          'INSERT INTO public.profiles'
        ]::text[]
      ),
      (
        'public.handle_profile_status_operation_ownership()',
        'search_path=public, pg_temp',
        true,
        ARRAY['current_setting(''app.bulk_status_operation_id'', true)']::text[]
      ),
      (
        'public.handle_trade_status_sync()',
        'search_path=public, pg_temp',
        true,
        ARRAY[]::text[]
      ),
      (
        'public.handle_trade_volume_update()',
        'search_path=public, pg_temp',
        true,
        ARRAY['UPDATE public.profiles']::text[]
      ),
      (
        'public.prevent_usd_value_at_trade_update()',
        'search_path=public, pg_temp',
        true,
        ARRAY[]::text[]
      ),
      (
        'public.fn_update_user_trade_metrics()',
        'search_path=public, pg_temp',
        true,
        ARRAY['UPDATE public.profiles']::text[]
      )
    ) AS targets(signature, expected_path, service_role_execute, required_refs)
  LOOP
    v_oid := to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Required profile/trigger function % is missing.', v_target.signature;
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
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_owner_before IS DISTINCT FROM 'postgres'
       OR v_definer_before IS DISTINCT FROM TRUE
       OR v_config_before IS DISTINCT FROM ARRAY[v_target.expected_path]::text[] THEN
      RAISE EXCEPTION
        'Function % owner, SECURITY DEFINER setting or existing search_path differs from the reviewed snapshot.',
        v_target.signature;
    END IF;

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
         FROM pg_catalog.pg_proc p
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) acl
         WHERE p.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Function % execution grants differ from the reviewed role boundary.', v_target.signature;
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
    FROM pg_catalog.pg_proc p
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
$profile_trigger_search_paths$;

COMMIT;
