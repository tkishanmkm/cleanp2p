-- Harden canonical escrow replay eligibility and serialize advertisement state reads.
-- This patch is deliberately limited to exact audited fragments of the installed RPC.
-- It does not change fee formulas, wallet/escrow mutations, trade status, or table data.
-- Also installs deterministic FOR UPDATE ad selection when the earlier row-lock migration has not yet run.
BEGIN;

DO $trade_escrow_replay_ad_lock$
DECLARE
  v_oid oid := to_regprocedure(
    'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_owner_before text;
  v_definer_before boolean;
  v_config_before text[];
  v_acl_before aclitem[];
  v_owner_after text;
  v_definer_after boolean;
  v_config_after text[];
  v_acl_after aclitem[];

  v_idempotency_marker text := '    -- 1.1 Strict Idempotency Key Validation';
  v_account_guard text := $guard$
    -- Account eligibility is checked before idempotency replay as well as before
    -- new escrow mutations. A disabled participant cannot use an old key to obtain
    -- a successful replay response after restrictions or an emergency freeze.
    IF NOT EXISTS (
      SELECT 1
        FROM public.profiles AS p
       WHERE p.id = v_effective_caller
         AND COALESCE(p.is_banned, FALSE) = FALSE
         AND COALESCE(p.is_restricted, FALSE) = FALSE
         AND COALESCE(p.is_on_hold, FALSE) = FALSE
         AND COALESCE(p.is_suspended, FALSE) = FALSE
         AND COALESCE(p.is_minor_restricted, FALSE) = FALSE
         AND COALESCE(p.is_emergency_frozen, FALSE) = FALSE
         AND p.status IS NOT NULL
         AND LOWER(BTRIM(p.status::TEXT)) = 'active'
         AND p.account_status IS NOT NULL
         AND LOWER(BTRIM(p.account_status)) = 'active'
    ) THEN
      RAISE EXCEPTION 'Trade initiation is disabled for this account.'
        USING ERRCODE = '42501', DETAIL = 'TRADE_INITIATION_ACCOUNT_DISABLED';
    END IF;

$guard$;

  v_old_key_check text := '    IF v_clean_idempotency IS NULL THEN';
  v_new_key_check text := '    IF v_clean_idempotency IS NULL OR pg_catalog.length(v_clean_idempotency) > 200 THEN';

  v_old_unlocked_lookup text := $lookup$
    SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1;
$lookup$;
  v_old_locked_lookup text := $lookup$
    SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1
    FOR UPDATE;
$lookup$;
  v_new_locked_lookup text := $lookup$
    SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    ORDER BY CASE
        WHEN id = TRIM(p_ad_id) THEN 0
        WHEN public_ad_id = TRIM(p_ad_id) THEN 1
        ELSE 2
    END,
    id
    LIMIT 1
    FOR UPDATE;
$lookup$;
  v_unlocked_lookup_count integer;
  v_locked_lookup_count integer;

  v_old_replay_price_check text :=
    '           OR (v_existing_trade.price IS DISTINCT FROM v_unit_price AND v_existing_trade.unit_price IS DISTINCT FROM v_unit_price) THEN';
  v_new_replay_price_check text :=
    '           OR COALESCE(v_existing_trade.price, v_existing_trade.unit_price) IS DISTINCT FROM v_unit_price' || E'\n' ||
    '           OR (v_existing_trade.price IS NOT NULL AND v_existing_trade.unit_price IS NOT NULL' || E'\n' ||
    '               AND v_existing_trade.price IS DISTINCT FROM v_existing_trade.unit_price) THEN';

  v_old_minor_guard text := '            OR COALESCE(p.is_minor_restricted, FALSE)';
  v_new_minor_guard text :=
    '            OR COALESCE(p.is_minor_restricted, FALSE)' || E'\n' ||
    '            OR COALESCE(p.is_on_hold, FALSE)' || E'\n' ||
    '            OR p.status IS NULL' || E'\n' ||
    '            OR LOWER(BTRIM(p.status::TEXT)) <> ''active''';

  v_count integer;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Required initiate_trade_with_escrow RPC is missing.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.pg_get_functiondef(p.oid)
  INTO
    v_owner_before,
    v_definer_before,
    v_config_before,
    v_acl_before,
    v_definition
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_before IS DISTINCT FROM 'postgres'
     OR v_definer_before IS DISTINCT FROM TRUE
     OR NOT COALESCE(v_config_before @> ARRAY['search_path=""'], FALSE) THEN
    RAISE EXCEPTION 'Escrow RPC owner/security/search_path differs from the audited contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
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
    RAISE EXCEPTION 'Escrow RPC grants do not match the authenticated/service_role-only contract.';
  END IF;

  -- Place the caller eligibility gate before both the idempotency key lookup
  -- and any replay response. Fail rather than duplicate or partially patch it.
  IF position('TRADE_INITIATION_ACCOUNT_DISABLED' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'The pre-replay account guard already exists; verify this migration was not applied out of band.';
  END IF;
  v_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_idempotency_marker, ''))
  ) / pg_catalog.length(v_idempotency_marker);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one strict idempotency marker; found %.', v_count;
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_idempotency_marker, v_account_guard || v_idempotency_marker);

  v_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_key_check, ''))
  ) / pg_catalog.length(v_old_key_check);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one idempotency null check; found %.', v_count;
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old_key_check, v_new_key_check);

  -- Support both valid predecessor states: the raw function, or the function
  -- after 20261108111210 installed FOR UPDATE. In either case the final lookup
  -- deterministically prefers exact internal ID, then the shared public ID.
  v_unlocked_lookup_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_unlocked_lookup, ''))
  ) / pg_catalog.length(v_old_unlocked_lookup);
  v_locked_lookup_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_locked_lookup, ''))
  ) / pg_catalog.length(v_old_locked_lookup);

  IF v_unlocked_lookup_count = 1 AND v_locked_lookup_count = 0 THEN
    v_definition := pg_catalog.replace(v_definition, v_old_unlocked_lookup, v_new_locked_lookup);
  ELSIF v_unlocked_lookup_count = 0 AND v_locked_lookup_count = 1 THEN
    v_definition := pg_catalog.replace(v_definition, v_old_locked_lookup, v_new_locked_lookup);
  ELSE
    RAISE EXCEPTION 'Expected exactly one recognized canonical ad lookup (locked or unlocked); found unlocked %, locked %.',
      v_unlocked_lookup_count, v_locked_lookup_count;
  END IF;

  v_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_replay_price_check, ''))
  ) / pg_catalog.length(v_old_replay_price_check);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one replay price consistency check; found %.', v_count;
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old_replay_price_check, v_new_replay_price_check);

  v_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old_minor_guard, ''))
  ) / pg_catalog.length(v_old_minor_guard);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected caller and counterparty account checks; found % minor-restriction anchors.', v_count;
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old_minor_guard, v_new_minor_guard);

  -- Verify every expected security and business invariant before execution.
  IF position('TRADE_INITIATION_ACCOUNT_DISABLED' IN v_definition) = 0
     OR position('COALESCE(p.is_emergency_frozen, FALSE)' IN v_definition) = 0
     OR position('COALESCE(p.is_on_hold, FALSE)' IN v_definition) = 0
     OR position('LENGTH(V_CLEAN_IDEMPOTENCY) > 200' IN pg_catalog.upper(v_definition)) = 0
     OR position('ORDER BY CASE' IN pg_catalog.upper(v_definition)) = 0
     OR position('LIMIT 1' || E'\n    FOR UPDATE;' IN v_definition) = 0
     OR position('COALESCE(V_EXISTING_TRADE.PRICE, V_EXISTING_TRADE.UNIT_PRICE) IS DISTINCT FROM V_UNIT_PRICE' IN pg_catalog.upper(v_definition)) = 0
     OR position('V_EXISTING_TRADE.PRICE IS DISTINCT FROM V_EXISTING_TRADE.UNIT_PRICE' IN pg_catalog.upper(v_definition)) = 0
     OR position('LOWER(BTRIM(P.STATUS::TEXT)) <> ''ACTIVE''' IN pg_catalog.upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Escrow RPC hardening verification failed; no function replacement executed.';
  END IF;

  EXECUTE v_definition;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.pg_get_functiondef(p.oid)
  INTO
    v_owner_after,
    v_definer_after,
    v_config_after,
    v_acl_after,
    v_definition
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION 'Escrow RPC replacement changed owner, security, search_path or grants.';
  END IF;

  IF position('TRADE_INITIATION_ACCOUNT_DISABLED' IN v_definition) = 0
     OR position('ORDER BY CASE' IN pg_catalog.upper(v_definition)) = 0
     OR position('FOR UPDATE;' IN pg_catalog.upper(v_definition)) = 0
     OR position('COALESCE(V_EXISTING_TRADE.PRICE, V_EXISTING_TRADE.UNIT_PRICE) IS DISTINCT FROM V_UNIT_PRICE' IN pg_catalog.upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Escrow RPC post-replacement contract checks failed.';
  END IF;
END;
$trade_escrow_replay_ad_lock$;

NOTIFY pgrst, 'reload schema';
COMMIT;
