-- Empty search_path on remaining schema-qualified trade SECURITY DEFINER
-- wrappers/triggers. Preserve each function body, owner, SECURITY DEFINER mode
-- and execution ACL. Run only after matching the exact catalog snapshot.
BEGIN;

DO $step_10_trade_search_paths$
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
        'public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)',
        'search_path=public, pg_temp',
        ARRAY[
          'public.initiate_trade_with_escrow(',
          'auth.uid()',
          'p_caller_id := COALESCE(auth.uid(), p_buyer_id)'
        ]::text[]
      ),
      (
        'public.fn_update_user_trade_metrics()',
        'search_path=public, pg_temp',
        ARRAY[
          'UPDATE public.profiles',
          'NEW.status',
          'NEW.buyer_id',
          'NEW.seller_id'
        ]::text[]
      ),
      (
        'public.handle_trade_status_sync()',
        'search_path=public, pg_temp',
        ARRAY[
          'OLD.status IS DISTINCT FROM NEW.status',
          'OLD.escrow_status IS DISTINCT FROM NEW.escrow_status',
          'RETURN NEW'
        ]::text[]
      ),
      (
        'public.handle_trade_volume_update()',
        'search_path=public, pg_temp',
        ARRAY[
          'UPDATE public.profiles',
          'NEW.status',
          'NEW.buyer_id',
          'NEW.seller_id'
        ]::text[]
      ),
      (
        'public.prevent_usd_value_at_trade_update()',
        'search_path=public, pg_temp',
        ARRAY[
          'NEW.usd_value_at_trade IS DISTINCT FROM OLD.usd_value_at_trade',
          'NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key',
          'NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint'
        ]::text[]
      )
    ) AS targets(signature, expected_path, required_refs)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_target.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION
        'Step 10 refused: required trade dependency % is missing.',
        v_target.signature;
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
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner_before IS DISTINCT FROM 'postgres'
       OR v_definer_before IS DISTINCT FROM TRUE
       OR v_config_before IS DISTINCT FROM ARRAY[v_target.expected_path]::text[] THEN
      RAISE EXCEPTION
        'Step 10 refused: function % owner, SECURITY DEFINER mode or search_path differs from the reviewed production snapshot.',
        v_target.signature;
    END IF;

    FOREACH v_required IN ARRAY v_target.required_refs
    LOOP
      IF pg_catalog.strpos(v_source_before, v_required) = 0 THEN
        RAISE EXCEPTION
          'Step 10 refused: function % is missing reviewed source fragment %.',
          v_target.signature,
          v_required;
      END IF;
    END LOOP;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM TRUE
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
      RAISE EXCEPTION
        'Step 10 refused: function % grants differ from the reviewed service-role-only contract.',
        v_target.signature;
    END IF;

    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET search_path TO %L',
      v_oid::regprocedure,
      ''
    );

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
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid;

    IF v_owner_after IS DISTINCT FROM v_owner_before
       OR v_definer_after IS DISTINCT FROM v_definer_before
       OR v_acl_after IS DISTINCT FROM v_acl_before
       OR v_source_after IS DISTINCT FROM v_source_before
       OR v_config_after IS DISTINCT FROM ARRAY['search_path=""']::text[] THEN
      RAISE EXCEPTION
        'Step 10 failed postcondition: function % body, owner, SECURITY DEFINER mode, grants or empty search_path changed unexpectedly.',
        v_target.signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Step 10 failed postcondition: function % execution grants changed.',
        v_target.signature;
    END IF;
  END LOOP;
END;
$step_10_trade_search_paths$;

COMMIT;
