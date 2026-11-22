-- Read-only verification that trade opening serializes against ad pause/delete.
DO $trade_ad_row_lock_preflight$
DECLARE
  v_oid oid := to_regprocedure(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_locked_lookup text := $$SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1
    FOR UPDATE;$$;
  v_lookup_start integer;
  v_guard_start integer;
  v_lookup text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'The expected initiate_trade_with_escrow function is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_oid), FALSE) THEN
    RAISE EXCEPTION 'Trade initiation must remain postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  v_lookup_start := position('SELECT * INTO v_ad' IN v_definition);
  v_guard_start := position('IF v_ad.id IS NOT NULL THEN' IN v_definition);
  IF v_lookup_start = 0 OR v_guard_start <= v_lookup_start THEN
    RAISE EXCEPTION 'Canonical advertisement lookup block could not be identified.';
  END IF;
  v_lookup := substring(v_definition FROM v_lookup_start FOR v_guard_start - v_lookup_start);

  IF position(v_locked_lookup IN v_definition) = 0
     OR position('COALESCE(v_ad.is_deleted, FALSE)' IN v_definition) = 0
     OR position($status_guard$UPPER(TRIM(COALESCE(v_ad.status, '')))$status_guard$ IN v_definition) = 0
     OR position('ADVERTISEMENT_INACTIVE' IN v_definition) = 0
     OR position('pg_advisory_xact_lock' IN v_definition) = 0
     OR position('IDEMPOTENCY_KEY_REQUIRED' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Trade initiation does not lock the ad row or lost its active/deleted/idempotency protections.';
  END IF;

  IF position('LIMIT 1;' IN v_lookup) > 0
     OR position('FOR UPDATE' IN v_lookup) = 0 THEN
    RAISE EXCEPTION 'Canonical advertisement lookup is not protected by a row lock.';
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
    RAISE EXCEPTION 'Trade initiation function execution grants are not correctly restricted.';
  END IF;
END;
$trade_ad_row_lock_preflight$;
