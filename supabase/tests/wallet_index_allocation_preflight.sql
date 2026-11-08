-- Read-only checks for the unified and server-only HD wallet index allocator.
DO $wallet_index_preflight$
DECLARE
  v_claim_oid OID := to_regprocedure('public.claim_next_wallet_index()');
  v_assign_oid OID := to_regprocedure('public.assign_missing_profile_wallet_indexes()');
  v_user_sequence_last BIGINT;
  v_legacy_sequence_last BIGINT;
  v_max_profile_index BIGINT;
  v_claim_definition TEXT;
  v_assign_definition TEXT;
BEGIN
  IF to_regclass('public.user_wallet_index_seq') IS NULL
     OR to_regclass('public.wallet_index_seq') IS NULL THEN
    RAISE EXCEPTION 'Expected wallet-index sequences are missing.';
  END IF;

  IF v_claim_oid IS NULL OR v_assign_oid IS NULL THEN
    RAISE EXCEPTION 'One or more wallet-index allocation RPCs are missing.';
  END IF;

  SELECT pg_get_functiondef(v_claim_oid) INTO v_claim_definition;
  SELECT pg_get_functiondef(v_assign_oid) INTO v_assign_definition;

  IF position('public.user_wallet_index_seq' IN v_claim_definition) = 0
     OR position('public.wallet_index_seq' IN v_claim_definition) > 0
     OR position(' - 1' IN v_claim_definition) > 0 THEN
    RAISE EXCEPTION 'claim_next_wallet_index must use user_wallet_index_seq directly without the legacy offset.';
  END IF;

  IF position('public.user_wallet_index_seq' IN v_assign_definition) = 0
     OR position('FOR UPDATE SKIP LOCKED' IN upper(v_assign_definition)) = 0
     OR position('service_role' IN v_assign_definition) = 0 THEN
    RAISE EXCEPTION 'The missing-profile allocator is not using the shared sequence, row locks or service-role guard.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid IN (v_claim_oid, v_assign_oid)
      AND (
        pg_get_userbyid(p.proowner) <> 'postgres'
        OR NOT p.prosecdef
        OR NOT COALESCE(p.proconfig @> ARRAY['search_path=""'], FALSE)
      )
  ) THEN
    RAISE EXCEPTION 'Wallet-index allocation RPCs must be postgres-owned SECURITY DEFINER functions with empty search_path.';
  END IF;

  IF has_function_privilege('anon', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_assign_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_assign_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_claim_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_assign_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Wallet-index RPC execute grants are not server-only.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE p.oid IN (v_claim_oid, v_assign_oid)
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has execute permission on a wallet-index allocation RPC.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (wallet_index)'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indrelid = 'public.profiles'::regclass
      AND indisunique
      AND indpred IS NULL
      AND pg_get_indexdef(indexrelid) ILIKE '%(wallet_index)%'
  ) THEN
    RAISE EXCEPTION 'A full unique wallet_index constraint/index is required.';
  END IF;

  IF EXISTS (
    SELECT wallet_index
    FROM public.profiles
    WHERE wallet_index IS NOT NULL
    GROUP BY wallet_index
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate wallet indexes exist in profiles.';
  END IF;

  EXECUTE 'SELECT last_value FROM public.user_wallet_index_seq'
    INTO v_user_sequence_last;
  EXECUTE 'SELECT last_value FROM public.wallet_index_seq'
    INTO v_legacy_sequence_last;
  SELECT COALESCE(MAX(wallet_index), 0)
    INTO v_max_profile_index
  FROM public.profiles;

  IF v_user_sequence_last < GREATEST(
      COALESCE(v_legacy_sequence_last, 1) - 1,
      COALESCE(v_max_profile_index, 0)
    ) THEN
    RAISE EXCEPTION 'The canonical wallet-index sequence is behind an allocated legacy/profile value.';
  END IF;
END;
$wallet_index_preflight$;
