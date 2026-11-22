-- Permit an authenticated participant to retry an already-created trade
-- before checking current ad/advertiser availability. New trade openings remain guarded.
-- Also prevent ineligible profiles from creating offline-attempt side effects.
-- Requires 20261108020000_guard_offline_ad_trade_opening.sql.
BEGIN;

DO $offline_attempt_replay_guard$
DECLARE
  v_oid oid := to_regprocedure('public.record_ad_offline_open_attempt(text,text)');
  v_definition text;
  v_owner_before text;
  v_definer_before boolean;
  v_config_before text[];
  v_acl_before aclitem[];
  v_owner_after text;
  v_definer_after boolean;
  v_config_after text[];
  v_acl_after aclitem[];

  v_declaration_old text := '  v_buyer_is_suspended boolean := false;';
  v_declaration_new text := E'  v_buyer_is_suspended boolean := false;\n  v_buyer_is_on_hold boolean := false;\n  v_buyer_is_minor_restricted boolean := false;\n  v_buyer_is_emergency_frozen boolean := false;';

  v_profile_select_old text := $profile_select$
  SELECT p.status::text, p.account_status, COALESCE(p.is_banned, false),
         COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false)
    INTO v_buyer_profile_status, v_buyer_account_status,
         v_buyer_is_banned, v_buyer_is_restricted, v_buyer_is_suspended
  FROM public.profiles p
  WHERE p.id = v_buyer_id;
$profile_select$;

  v_profile_select_new text := $profile_select$
  SELECT p.status::text, p.account_status, COALESCE(p.is_banned, false),
         COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false),
         COALESCE(p.is_on_hold, false), COALESCE(p.is_minor_restricted, false),
         COALESCE(p.is_emergency_frozen, false)
    INTO v_buyer_profile_status, v_buyer_account_status,
         v_buyer_is_banned, v_buyer_is_restricted, v_buyer_is_suspended,
         v_buyer_is_on_hold, v_buyer_is_minor_restricted, v_buyer_is_emergency_frozen
  FROM public.profiles p
  WHERE p.id = v_buyer_id;
$profile_select_new$;

  v_eligibility_old text := $eligibility$
  IF NOT FOUND
     OR COALESCE(v_buyer_is_banned, false)
     OR COALESCE(v_buyer_is_restricted, false)
     OR COALESCE(v_buyer_is_suspended, false)
     OR LOWER(COALESCE(v_buyer_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
     OR UPPER(COALESCE(v_buyer_account_status, '')) IN ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
$eligibility$;

  v_eligibility_new text := $eligibility$
  IF NOT FOUND
     OR COALESCE(v_buyer_is_banned, false)
     OR COALESCE(v_buyer_is_restricted, false)
     OR COALESCE(v_buyer_is_suspended, false)
     OR COALESCE(v_buyer_is_on_hold, false)
     OR COALESCE(v_buyer_is_minor_restricted, false)
     OR COALESCE(v_buyer_is_emergency_frozen, false)
     OR LOWER(BTRIM(COALESCE(v_buyer_profile_status, ''))) <> 'active'
     OR LOWER(BTRIM(COALESCE(v_buyer_account_status, ''))) <> 'active' THEN
$eligibility$;

  v_ad_lock_marker text := '  -- Lock the ad record and resolve the same public ad across canonical and legacy tables.';
  v_replay_marker text := '  -- OFFLINE_ATTEMPT_REPLAY_GUARD: Existing authenticated participant retries must reach the escrow RPC before online/ad-state checks.';
  v_replay_block text := $replay$
  -- OFFLINE_ATTEMPT_REPLAY_GUARD: Existing authenticated participant retries must reach the escrow RPC before online/ad-state checks.
  -- The escrow RPC still validates the idempotency fingerprint, exact ad identity,
  -- participants, current caller eligibility and request parameters before replaying.
  IF EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.idempotency_key = BTRIM(p_idempotency_key)
      AND (t.buyer_id = v_buyer_id::text OR t.seller_id = v_buyer_id::text)
  ) THEN
    RETURN jsonb_build_object(
      'ad_found', true,
      'ad_active', true,
      'seller_online', true,
      'attempts', 0,
      'deactivated', false,
      'idempotent_replay', true
    );
  END IF;

$replay$;

  v_count integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'record_ad_offline_open_attempt is missing; apply its prerequisite migration first.';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles'
         AND column_name='is_on_hold' AND data_type='boolean'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles'
         AND column_name='is_minor_restricted' AND data_type='boolean'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles'
         AND column_name='is_emergency_frozen' AND data_type='boolean'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='trades'
         AND column_name='idempotency_key' AND data_type='text'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='trades'
         AND column_name='buyer_id' AND data_type='text'
     )
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='trades'
         AND column_name='seller_id' AND data_type='text'
     ) THEN
    RAISE EXCEPTION 'Offline replay guard profile/trade schema prerequisites are missing.';
  END IF;

  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid)
    INTO v_owner_before, v_definer_before, v_config_before, v_acl_before, v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_before IS DISTINCT FROM 'postgres'
     OR v_definer_before IS DISTINCT FROM TRUE
     OR NOT COALESCE(v_config_before @> ARRAY['search_path=""'], false) THEN
    RAISE EXCEPTION 'Offline-attempt RPC owner/security/search_path differs from its reviewed contract.';
  END IF;

  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc AS p
       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
       WHERE p.oid = v_oid
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Offline-attempt RPC grants do not match authenticated/service_role-only access.';
  END IF;

  IF strpos(v_definition, v_replay_marker) > 0 THEN
    RAISE EXCEPTION 'Offline-attempt replay bypass already exists; refusing duplicate patch.';
  END IF;

  v_count := (length(v_definition) - length(replace(v_definition, v_declaration_old, ''))) / length(v_declaration_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one buyer suspension declaration; found %.', v_count;
  END IF;
  v_definition := replace(v_definition, v_declaration_old, v_declaration_new);

  v_count := (length(v_definition) - length(replace(v_definition, v_profile_select_old, ''))) / length(v_profile_select_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one buyer profile selection block; found %.', v_count;
  END IF;
  v_definition := replace(v_definition, v_profile_select_old, v_profile_select_new);

  v_count := (length(v_definition) - length(replace(v_definition, v_eligibility_old, ''))) / length(v_eligibility_old);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one buyer eligibility guard; found %.', v_count;
  END IF;
  v_definition := replace(v_definition, v_eligibility_old, v_eligibility_new);

  v_count := (length(v_definition) - length(replace(v_definition, v_ad_lock_marker, ''))) / length(v_ad_lock_marker);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected one canonical ad-lock insertion marker; found %.', v_count;
  END IF;
  v_definition := replace(v_definition, v_ad_lock_marker, v_replay_block || v_ad_lock_marker);

  IF strpos(v_definition, v_replay_marker) = 0
     OR strpos(v_definition, 't.idempotency_key = BTRIM(p_idempotency_key)') = 0
     OR strpos(v_definition, 't.buyer_id = v_buyer_id::text') = 0
     OR strpos(v_definition, 't.seller_id = v_buyer_id::text') = 0
     OR strpos(v_definition, 'v_buyer_is_on_hold') = 0
     OR strpos(v_definition, 'v_buyer_is_minor_restricted') = 0
     OR strpos(v_definition, 'v_buyer_is_emergency_frozen') = 0
     OR strpos(upper(v_definition), $active_profile$LOWER(BTRIM(COALESCE(V_BUYER_PROFILE_STATUS, ''))) <> 'ACTIVE'$active_profile$) = 0
     OR strpos(upper(v_definition), $active_account$LOWER(BTRIM(COALESCE(V_BUYER_ACCOUNT_STATUS, ''))) <> 'ACTIVE'$active_account$) = 0 THEN
    RAISE EXCEPTION 'Offline-attempt replay/eligibility replacement failed static verification.';
  END IF;

  EXECUTE v_definition;

  SELECT pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid)
    INTO v_owner_after, v_definer_after, v_config_after, v_acl_after, v_definition
  FROM pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION 'Offline-attempt RPC owner/security/search_path/grants changed unexpectedly.';
  END IF;

  IF strpos(v_definition, v_replay_marker) = 0
     OR strpos(v_definition, 't.idempotency_key = BTRIM(p_idempotency_key)') = 0 THEN
    RAISE EXCEPTION 'Offline-attempt RPC post-replacement replay bypass verification failed.';
  END IF;
END;
$offline_attempt_replay_guard$;

NOTIFY pgrst, 'reload schema';
COMMIT;
