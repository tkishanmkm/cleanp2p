-- Read-only checks for early escrow replay eligibility and deterministic ad locking.
DO $trade_escrow_replay_ad_lock_preflight$
DECLARE
  v_oid oid := to_regprocedure(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_account_position integer;
  v_idempotency_position integer;
  v_replay_lookup_position integer;
  v_ad_select_position integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'initiate_trade_with_escrow is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=v_oid), FALSE) THEN
    RAISE EXCEPTION 'Escrow RPC must remain postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE p.oid=v_oid AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Escrow RPC grants must remain authenticated/service_role only.';
  END IF;

  v_account_position := position('TRADE_INITIATION_ACCOUNT_DISABLED' IN upper(v_definition));
  v_idempotency_position := position('-- 1.1 STRICT IDEMPOTENCY KEY VALIDATION' IN upper(v_definition));
  v_replay_lookup_position := position('SELECT * INTO V_EXISTING_TRADE' IN upper(v_definition));
  v_ad_select_position := position('SELECT * INTO V_AD' IN upper(v_definition));

  IF v_account_position = 0
     OR v_idempotency_position = 0
     OR v_replay_lookup_position = 0
     OR NOT (v_account_position < v_idempotency_position AND v_idempotency_position < v_replay_lookup_position)
     OR position('COALESCE(P.IS_BANNED, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('COALESCE(P.IS_RESTRICTED, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('COALESCE(P.IS_ON_HOLD, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('COALESCE(P.IS_SUSPENDED, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('COALESCE(P.IS_MINOR_RESTRICTED, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('COALESCE(P.IS_EMERGENCY_FROZEN, FALSE) = FALSE' IN upper(v_definition)) = 0
     OR position('LOWER(BTRIM(P.STATUS::TEXT)) = ''ACTIVE''' IN upper(v_definition)) = 0
     OR position('LOWER(BTRIM(P.ACCOUNT_STATUS)) = ''ACTIVE''' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Disabled/missing callers must be rejected before idempotency lookup or replay.';
  END IF;

  IF EXISTS (
       SELECT 1
       FROM unnest(ARRAY[
         'is_banned','is_restricted','is_on_hold','is_suspended',
         'is_minor_restricted','is_emergency_frozen','status','account_status'
       ]::text[]) AS required(column_name)
       WHERE NOT EXISTS (
         SELECT 1 FROM information_schema.columns c
         WHERE c.table_schema='public' AND c.table_name='profiles'
           AND c.column_name=required.column_name
       )
     ) THEN
    RAISE EXCEPTION 'Profile account eligibility columns required by the escrow RPC are missing.';
  END IF;

  IF position('LENGTH(V_CLEAN_IDEMPOTENCY) > 200' IN upper(v_definition)) = 0
     OR position('ORDER BY CASE' IN upper(v_definition)) = 0
     OR v_ad_select_position = 0
     OR position('LIMIT 1' || E'\n    FOR UPDATE;' IN substring(v_definition from v_ad_select_position for 900)) = 0
     OR position('WHEN ID = TRIM(P_AD_ID) THEN 0' IN upper(substring(v_definition from v_ad_select_position for 900))) = 0
     OR position('WHEN PUBLIC_AD_ID = TRIM(P_AD_ID) THEN 1' IN upper(substring(v_definition from v_ad_select_position for 900))) = 0 THEN
    RAISE EXCEPTION 'Escrow ad lookup must use deterministic public-ID precedence and lock the selected row FOR UPDATE.';
  END IF;

  IF position('COALESCE(V_EXISTING_TRADE.PRICE, V_EXISTING_TRADE.UNIT_PRICE) IS DISTINCT FROM V_UNIT_PRICE' IN upper(v_definition)) = 0
     OR position('V_EXISTING_TRADE.PRICE IS DISTINCT FROM V_EXISTING_TRADE.UNIT_PRICE' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Idempotent replay must reject stale/divergent stored price values.';
  END IF;

  IF (length(upper(v_definition)) - length(replace(upper(v_definition), 'COALESCE(P.IS_ON_HOLD, FALSE)', ''))) / length('COALESCE(P.IS_ON_HOLD, FALSE)') <> 3
     OR (length(upper(v_definition)) - length(replace(upper(v_definition), 'LOWER(BTRIM(P.STATUS::TEXT)) <> ''ACTIVE''', ''))) / length('LOWER(BTRIM(P.STATUS::TEXT)) <> ''ACTIVE''') <> 2 THEN
    RAISE EXCEPTION 'The pre-replay caller gate and both locked participant checks must include on-hold and explicit active status.';
  END IF;
END;
$trade_escrow_replay_ad_lock_preflight$;
