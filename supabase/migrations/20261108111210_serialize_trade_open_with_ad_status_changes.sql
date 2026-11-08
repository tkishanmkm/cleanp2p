-- Serialize new trade openings with the canonical advertisement status/deletion lock.
-- This only changes the ad lookup lock; it does not change financial calculations or mutations.
BEGIN;

DO $trade_ad_row_lock_migration$
DECLARE
  v_oid oid := to_regprocedure(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_old_lookup text := $$SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1;$$;
  v_locked_lookup text := $$SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1
    FOR UPDATE;$$;
  v_owner_before text;
  v_definer_before boolean;
  v_config_before text[];
  v_acl_before aclitem[];
  v_owner_after text;
  v_definer_after boolean;
  v_config_after text[];
  v_acl_after aclitem[];
  v_lookup_occurrences integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'The expected initiate_trade_with_escrow function is missing.';
  END IF;

  SELECT
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_get_functiondef(p.oid)
  INTO
    v_owner_before,
    v_definer_before,
    v_config_before,
    v_acl_before,
    v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_before <> 'postgres'
     OR v_definer_before IS DISTINCT FROM TRUE
     OR NOT COALESCE(v_config_before @> ARRAY['search_path=""'], FALSE) THEN
    RAISE EXCEPTION 'Trade initiation function owner/security/search_path differs from the expected contract.';
  END IF;

  IF position('COALESCE(v_ad.is_deleted, FALSE)' IN v_definition) = 0
     OR position('v_ad_is_active' IN v_definition) = 0
     OR position('pg_advisory_xact_lock' IN v_definition) = 0
     OR position('IDEMPOTENCY_KEY_REQUIRED' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trade initiation function does not match the expected active/deleted/idempotency contract.';
  END IF;

  v_lookup_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_lookup, '')))
    / length(v_old_lookup);

  IF v_lookup_occurrences <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one unlocked canonical ad lookup; found %.', v_lookup_occurrences;
  END IF;

  EXECUTE replace(v_definition, v_old_lookup, v_locked_lookup);

  SELECT
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_get_functiondef(p.oid)
  INTO
    v_owner_after,
    v_definer_after,
    v_config_after,
    v_acl_after,
    v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_oid;

  IF position(v_locked_lookup IN v_definition) = 0
     OR v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION 'Trade ad row locking was not installed without preserving the function security contract.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     )
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Trade initiation function execution grants do not match the pre-migration contract.';
  END IF;
END;
$trade_ad_row_lock_migration$;

NOTIFY pgrst, 'reload schema';
COMMIT;
