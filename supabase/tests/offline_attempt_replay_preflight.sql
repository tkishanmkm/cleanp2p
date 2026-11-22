-- Read-only contract checks for authorized idempotent replay through advertiser availability guard.
DO $offline_attempt_replay_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.record_ad_offline_open_attempt(text,text)');
  v_definition text;
  v_account_position integer;
  v_replay_position integer;
  v_ad_lock_position integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'record_ad_offline_open_attempt is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
     OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_oid), false) THEN
    RAISE EXCEPTION 'Offline-attempt RPC must remain postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = v_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Offline-attempt RPC grants must remain authenticated/service_role only.';
  END IF;

  v_account_position := strpos(upper(v_definition), $active_profile$LOWER(BTRIM(COALESCE(V_BUYER_PROFILE_STATUS, ''))) <> 'ACTIVE'$active_profile$);
  v_replay_position := position('OFFLINE_ATTEMPT_REPLAY_GUARD' IN upper(v_definition));
  v_ad_lock_position := position('-- LOCK THE AD RECORD AND RESOLVE THE SAME PUBLIC AD' IN upper(v_definition));

  IF v_account_position = 0
     OR v_replay_position = 0
     OR v_ad_lock_position = 0
     OR NOT (v_account_position < v_replay_position AND v_replay_position < v_ad_lock_position)
     OR position('COALESCE(V_BUYER_IS_ON_HOLD, FALSE)' IN upper(v_definition)) = 0
     OR position('COALESCE(V_BUYER_IS_MINOR_RESTRICTED, FALSE)' IN upper(v_definition)) = 0
     OR position('COALESCE(V_BUYER_IS_EMERGENCY_FROZEN, FALSE)' IN upper(v_definition)) = 0
     OR strpos(upper(v_definition), $active_profile$LOWER(BTRIM(COALESCE(V_BUYER_PROFILE_STATUS, ''))) <> 'ACTIVE'$active_profile$) = 0
     OR strpos(upper(v_definition), $active_account$LOWER(BTRIM(COALESCE(V_BUYER_ACCOUNT_STATUS, ''))) <> 'ACTIVE'$active_account$) = 0 THEN
    RAISE EXCEPTION 'Offline-attempt caller eligibility must precede replay handling and all ad/offline side effects.';
  END IF;

  IF position('T.IDEMPOTENCY_KEY = BTRIM(P_IDEMPOTENCY_KEY)' IN upper(v_definition)) = 0
     OR position('T.BUYER_ID = V_BUYER_ID::TEXT' IN upper(v_definition)) = 0
     OR position('T.SELLER_ID = V_BUYER_ID::TEXT' IN upper(v_definition)) = 0
     OR position('IDEMPOTENT_REPLAY' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Only an existing trade participant may bypass the current online/ad-state check.';
  END IF;
END;
$offline_attempt_replay_preflight$;
