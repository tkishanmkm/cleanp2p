-- Read-only preflight for WAYONES wallet registry reconciliation.
-- This script never creates, updates, deletes, grants, revokes, or changes data.
-- Run only after confirming the target database is the intended WAYONES environment.

DO $wallet_registry_reconciliation$
DECLARE
  v_findings TEXT[] := ARRAY[]::TEXT[];
  v_missing_columns TEXT;
  v_profile_index_unique BOOLEAN := FALSE;
  v_profile_index_attnum SMALLINT;
  v_allocator_oid OID := to_regprocedure('public.allocate_hot_wallet_nonce(text,text,bigint)');
  v_claim_oid OID := to_regprocedure('public.claim_next_wallet_index()');
  v_assign_oid OID := to_regprocedure('public.assign_missing_profile_wallet_indexes()');
  v_provision_oid OID := to_regprocedure('public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)');
  v_signup_wallet_oid OID := to_regprocedure('public.handle_new_user_wallets()');
  v_signup_profile_oid OID := to_regprocedure('public.handle_new_user()');
  v_function_definition TEXT;
  v_signup_wallet_definition TEXT;
  v_signup_owner TEXT;
  v_signup_is_definer BOOLEAN;
  v_wallet_insert_position INTEGER;
  v_profile_insert_position INTEGER;
  v_conflict_count BIGINT := 0;
  v_rls BOOLEAN;
BEGIN
  -- 1. Verify the schema required by the repository's canonical wallet
  --    provisioning RPC and address registry.
  WITH required_columns(table_name, column_name) AS (
    VALUES
      ('profiles', 'wallet_index'),
      ('profiles', 'evm_deposit_address'),
      ('profiles', 'tron_deposit_address'),
      ('profiles', 'btc_deposit_address'),
      ('profiles', 'ltc_deposit_address'),
      ('user_deposit_addresses', 'user_id'),
      ('user_deposit_addresses', 'wallet_id'),
      ('user_deposit_addresses', 'address'),
      ('user_deposit_addresses', 'network'),
      ('user_deposit_addresses', 'asset_symbol'),
      ('user_deposit_addresses', 'chain'),
      ('user_deposit_addresses', 'asset_code'),
      ('user_deposit_addresses', 'network_code'),
      ('user_deposit_addresses', 'derivation_path'),
      ('wallets', 'user_id'),
      ('wallets', 'wallet_index'),
      ('wallets', 'evm_address'),
      ('wallets', 'tron_address'),
      ('wallets', 'btc_address'),
      ('wallets', 'ltc_address'),
      ('wallets', 'status'),
      ('wallet_assets', 'user_id'),
      ('wallet_assets', 'asset_symbol'),
      ('wallet_assets', 'asset_code'),
      ('wallet_assets', 'balance'),
      ('wallet_assets', 'available'),
      ('wallet_assets', 'locked_balance'),
      ('wallet_assets', 'in_escrow'),
      ('wallet_assets', 'in_withdrawal'),
      ('wallet_provisioning', 'user_id'),
      ('wallet_provisioning', 'wallet_id'),
      ('wallet_provisioning', 'asset_code'),
      ('wallet_provisioning', 'network_code'),
      ('wallet_provisioning', 'status'),
      ('wallet_provisioning', 'idempotency_key'),
      ('deposit_addresses', 'user_id'),
      ('deposit_addresses', 'wallet_id'),
      ('deposit_addresses', 'address'),
      ('deposit_addresses', 'asset_code'),
      ('deposit_addresses', 'network_code'),
      ('deposit_addresses', 'derivation_path')
  )
  SELECT string_agg(required_columns.table_name || '.' || required_columns.column_name, ', ' ORDER BY required_columns.table_name, required_columns.column_name)
    INTO v_missing_columns
  FROM required_columns
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = required_columns.table_name
      AND c.column_name = required_columns.column_name
  );

  IF v_missing_columns IS NOT NULL THEN
    v_findings := array_append(v_findings, 'Missing canonical wallet registry columns: ' || v_missing_columns);
  END IF;

  -- 2. Verify the index allocator and atomic provisioning contract exist.
  IF to_regclass('public.user_wallet_index_seq') IS NULL THEN
    v_findings := array_append(v_findings, 'Missing public.user_wallet_index_seq');
  END IF;
  IF v_claim_oid IS NULL THEN
    v_findings := array_append(v_findings, 'Missing public.claim_next_wallet_index()');
  END IF;
  IF v_assign_oid IS NULL THEN
    v_findings := array_append(v_findings, 'Missing public.assign_missing_profile_wallet_indexes()');
  END IF;
  IF v_provision_oid IS NULL THEN
    v_findings := array_append(v_findings, 'Missing public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)');
  END IF;

  -- 3. The profile index must be unique, single-column, valid, and either full
  --    or the canonical partial index WHERE wallet_index IS NOT NULL.
  SELECT a.attnum
    INTO v_profile_index_attnum
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.profiles')
    AND a.attname = 'wallet_index'
    AND NOT a.attisdropped;

  IF v_profile_index_attnum IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = 'public.profiles'::regclass
        AND c.contype = 'u'
        AND c.conkey = ARRAY[v_profile_index_attnum]::smallint[]
    ) OR EXISTS (
      SELECT 1
      FROM pg_index idx
      WHERE idx.indrelid = 'public.profiles'::regclass
        AND idx.indisunique
        AND idx.indisvalid
        AND idx.indisready
        AND idx.indnatts = 1
        AND idx.indnkeyatts = 1
        AND idx.indexprs IS NULL
        AND idx.indkey[0] = v_profile_index_attnum
        AND (
          idx.indpred IS NULL
          OR pg_get_expr(idx.indpred, idx.indrelid) IN (
            '(wallet_index IS NOT NULL)',
            'wallet_index IS NOT NULL'
          )
        )
    )
    INTO v_profile_index_unique;

    IF NOT v_profile_index_unique THEN
      v_findings := array_append(v_findings, 'profiles.wallet_index lacks a valid single-column unique constraint/index');
    END IF;
  END IF;

  -- 4. Verify service-only EXECUTE permissions on wallet allocation,
  --    provisioning and legacy hot-wallet nonce allocation RPCs.
  IF v_claim_oid IS NOT NULL AND (
    has_function_privilege('anon', v_claim_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_claim_oid, 'EXECUTE')
  ) THEN
    v_findings := array_append(v_findings, 'claim_next_wallet_index() EXECUTE grants are not service-role-only');
  END IF;

  IF v_assign_oid IS NOT NULL AND (
    has_function_privilege('anon', v_assign_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_assign_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_assign_oid, 'EXECUTE')
  ) THEN
    v_findings := array_append(v_findings, 'assign_missing_profile_wallet_indexes() EXECUTE grants are not service-role-only');
  END IF;

  IF v_provision_oid IS NOT NULL AND (
    has_function_privilege('anon', v_provision_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_provision_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_provision_oid, 'EXECUTE')
  ) THEN
    v_findings := array_append(v_findings, 'provision_user_wallets_atomic() EXECUTE grants are not service-role-only');
  END IF;

  IF v_allocator_oid IS NOT NULL AND (
    has_function_privilege('anon', v_allocator_oid, 'EXECUTE')
    OR has_function_privilege('authenticated', v_allocator_oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', v_allocator_oid, 'EXECUTE')
  ) THEN
    v_findings := array_append(v_findings, 'allocate_hot_wallet_nonce(text,text,bigint) EXECUTE grants are not service-role-only');
  END IF;

  -- 5. The legacy provisioning RPC still contains an owner-upsert clause.
  --    It is accepted only when the database-level immutable-identity trigger
  --    is installed and enabled on the registry table.
  IF v_provision_oid IS NOT NULL THEN
    SELECT pg_get_functiondef(v_provision_oid) INTO v_function_definition;

    IF v_function_definition ~* 'DO UPDATE SET[[:space:]]+user_id[[:space:]]*=[[:space:]]*EXCLUDED\.user_id'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc f ON f.oid = t.tgfoid
        JOIN pg_namespace fn ON fn.oid = f.pronamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'user_deposit_addresses'
          AND t.tgname = 'wayones_user_deposit_address_identity_guard'
          AND t.tgenabled IN ('O', 'A')
          AND NOT t.tgisinternal
          AND fn.nspname = 'private'
          AND f.proname = 'guard_user_deposit_address_identity'
      )
    THEN
      v_findings := array_append(v_findings, 'provision_user_wallets_atomic() can overwrite an existing deposit-address owner because the immutable-identity guard is missing or disabled');
    END IF;

    IF v_function_definition ~* 'ON CONFLICT[[:space:]]*\([[:space:]]*address[[:space:]]*,[[:space:]]*network[[:space:]]*\)'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index idx
        WHERE idx.indrelid = 'public.user_deposit_addresses'::regclass
          AND idx.indisunique
          AND idx.indisvalid
          AND idx.indisready
          AND idx.indnatts = 2
          AND idx.indnkeyatts = 2
          AND idx.indexprs IS NULL
          AND idx.indpred IS NULL
          AND pg_get_indexdef(idx.indexrelid, 1, true) = 'address'
          AND pg_get_indexdef(idx.indexrelid, 2, true) = 'network'
      )
    THEN
      v_findings := array_append(v_findings, 'provision_user_wallets_atomic() uses ON CONFLICT(address, network) without a matching simple unique index');
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index idx
    WHERE idx.indrelid = 'public.profiles'::regclass
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = 1
      AND idx.indnkeyatts = 1
      AND pg_get_indexdef(idx.indexrelid, 1, true) = 'wallet_index'
  ) THEN
    v_findings := array_append(v_findings, 'Full single-column profiles.wallet_index unique index is missing');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index idx
    WHERE idx.indrelid = 'public.user_deposit_addresses'::regclass
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indnatts = 2
      AND idx.indnkeyatts = 2
      AND pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%CASE WHEN%'
      AND pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%lower(btrim(address))%'
      AND pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%upper(btrim(network))%'
  ) THEN
    v_findings := array_append(v_findings, 'Normalized address/network unique index is missing');
  END IF;

  -- Signup identity functions must run as postgres and the wallet helper
  -- must create the profile before inserting its wallet row.
  IF v_signup_profile_oid IS NOT NULL THEN
    SELECT pg_get_userbyid(p.proowner), p.prosecdef
      INTO v_signup_owner, v_signup_is_definer
    FROM pg_proc p
    WHERE p.oid = v_signup_profile_oid;

    IF v_signup_owner IS DISTINCT FROM 'postgres'
       OR v_signup_is_definer IS DISTINCT FROM TRUE THEN
      v_findings := array_append(v_findings, 'handle_new_user() is not postgres-owned SECURITY DEFINER');
    END IF;
  END IF;

  IF v_signup_wallet_oid IS NOT NULL THEN
    SELECT pg_get_userbyid(p.proowner), p.prosecdef
      INTO v_signup_owner, v_signup_is_definer
    FROM pg_proc p
    WHERE p.oid = v_signup_wallet_oid;

    IF v_signup_owner IS DISTINCT FROM 'postgres'
       OR v_signup_is_definer IS DISTINCT FROM TRUE THEN
      v_findings := array_append(v_findings, 'handle_new_user_wallets() is not postgres-owned SECURITY DEFINER');
    END IF;

    SELECT lower(pg_get_functiondef(v_signup_wallet_oid))
    INTO v_signup_wallet_definition;

    v_wallet_insert_position := strpos(v_signup_wallet_definition, 'insert into public.wallets');
    v_profile_insert_position := strpos(v_signup_wallet_definition, 'insert into public.profiles');

    IF v_wallet_insert_position > 0
       AND (
         v_profile_insert_position = 0
         OR v_wallet_insert_position < v_profile_insert_position
       ) THEN
      v_findings := array_append(v_findings, 'handle_new_user_wallets() inserts wallet rows before profiles; signup flow is incompatible with the wallet identity trigger');
    END IF;
  END IF;

  -- 5A. All identity guards must be installed, enabled and remain SECURITY
  --     INVOKER functions with an empty search_path and no direct API grants.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc f ON f.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = f.pronamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'wayones_profile_wallet_identity_guard'
      AND t.tgenabled IN ('O', 'A')
      AND pg_get_triggerdef(t.oid) ILIKE '%INSERT OR UPDATE%'
      AND NOT t.tgisinternal
      AND fn.nspname = 'private'
      AND f.proname = 'guard_profile_wallet_identity'
  ) THEN
    v_findings := array_append(v_findings, 'Profile wallet identity guard trigger is missing or disabled');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc f ON f.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = f.pronamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'wallets'
      AND t.tgname = 'wayones_wallet_identity_guard'
      AND t.tgenabled IN ('O', 'A')
      AND pg_get_triggerdef(t.oid) ILIKE '%INSERT OR UPDATE%'
      AND NOT t.tgisinternal
      AND fn.nspname = 'private'
      AND f.proname = 'guard_wallet_row_identity'
  ) THEN
    v_findings := array_append(v_findings, 'Wallet row identity guard trigger is missing or disabled');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc f ON f.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = f.pronamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_deposit_addresses'
      AND t.tgname = 'wayones_user_deposit_address_identity_guard'
      AND t.tgenabled IN ('O', 'A')
      AND pg_get_triggerdef(t.oid) ILIKE '%INSERT OR UPDATE%'
      AND NOT t.tgisinternal
      AND fn.nspname = 'private'
      AND f.proname = 'guard_user_deposit_address_identity'
  ) THEN
    v_findings := array_append(v_findings, 'User deposit-address identity guard trigger is missing or disabled');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc f ON f.oid = t.tgfoid
    JOIN pg_namespace fn ON fn.oid = f.pronamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'deposit_addresses'
      AND t.tgname = 'wayones_deposit_address_identity_guard'
      AND t.tgenabled IN ('O', 'A')
      AND pg_get_triggerdef(t.oid) ILIKE '%INSERT OR UPDATE%'
      AND NOT t.tgisinternal
      AND fn.nspname = 'private'
      AND f.proname = 'guard_deposit_address_identity'
  ) THEN
    v_findings := array_append(v_findings, 'Deposit-address identity guard trigger is missing or disabled');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'guard_profile_wallet_identity',
        'guard_wallet_row_identity',
        'guard_user_deposit_address_identity',
        'guard_deposit_address_identity'
      )
      AND (
        pg_get_userbyid(p.proowner) <> 'postgres'
        OR p.prosecdef
        OR NOT coalesce(p.proconfig @> ARRAY['search_path=""']::TEXT[], false)
        OR has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  ) THEN
    v_findings := array_append(v_findings, 'Identity guard functions are SECURITY DEFINER, use a non-empty search_path, or have direct API/service-role EXECUTE grants');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN (
        'guard_profile_wallet_identity',
        'guard_wallet_row_identity',
        'guard_user_deposit_address_identity',
        'guard_deposit_address_identity'
      )
      AND position('current_user not in' IN lower(p.prosrc)) = 0
  ) THEN
    v_findings := array_append(v_findings, 'One or more identity guards do not restrict identity writes to postgres/service_role');
  END IF;

  IF to_regprocedure('private.guard_wallet_row_identity()') IS NULL THEN
    v_findings := array_append(v_findings, 'Wallet-row identity guard function is missing');
  ELSE
    SELECT pg_get_functiondef(to_regprocedure('private.guard_wallet_row_identity()'))
      INTO v_function_definition;
    IF position('new.wallet_index is distinct from v_profile.wallet_index' IN lower(v_function_definition)) = 0
       OR position('wallet ownership cannot be reassigned' IN lower(v_function_definition)) = 0 THEN
      v_findings := array_append(v_findings, 'Wallet-row guard does not enforce exact profile-index matching and immutable owner identity');
    END IF;
  END IF;

  IF to_regprocedure('private.guard_user_deposit_address_identity()') IS NULL THEN
    v_findings := array_append(v_findings, 'User deposit-address identity guard function is missing');
  ELSE
    SELECT pg_get_functiondef(to_regprocedure('private.guard_user_deposit_address_identity()'))
      INTO v_function_definition;
    IF position('new.derivation_path is distinct from v_expected_path' IN lower(v_function_definition)) = 0
       OR position('a registered user deposit address identity cannot be changed or reassigned' IN lower(v_function_definition)) = 0 THEN
      v_findings := array_append(v_findings, 'User deposit-address guard does not enforce canonical path matching and immutable owner identity');
    END IF;
  END IF;

  IF to_regprocedure('private.guard_deposit_address_identity()') IS NULL THEN
    v_findings := array_append(v_findings, 'Legacy deposit-address identity guard function is missing');
  ELSE
    SELECT pg_get_functiondef(to_regprocedure('private.guard_deposit_address_identity()'))
      INTO v_function_definition;
    IF position('deposit address wallet link must belong to the same user' IN lower(v_function_definition)) = 0
       OR position('a registered deposit address identity cannot be changed or reassigned' IN lower(v_function_definition)) = 0 THEN
      v_findings := array_append(v_findings, 'Legacy deposit-address guard does not enforce immutable identity and same-user wallet links');
    END IF;
  END IF;

  IF v_missing_columns IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.wallets AS w
      LEFT JOIN public.profiles AS p ON p.id = w.user_id
      WHERE p.id IS NULL
         OR p.wallet_index IS NULL
         OR w.wallet_index IS DISTINCT FROM p.wallet_index
         OR (p.evm_deposit_address IS NULL AND w.evm_address IS NOT NULL)
         OR (p.evm_deposit_address IS NOT NULL
             AND lower(btrim(w.evm_address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address)))
         OR (p.tron_deposit_address IS NULL AND w.tron_address IS NOT NULL)
         OR (p.tron_deposit_address IS NOT NULL
             AND btrim(w.tron_address) IS DISTINCT FROM btrim(p.tron_deposit_address))
         OR (p.btc_deposit_address IS NULL AND w.btc_address IS NOT NULL)
         OR (p.btc_deposit_address IS NOT NULL
             AND btrim(w.btc_address) IS DISTINCT FROM btrim(p.btc_deposit_address))
         OR (p.ltc_deposit_address IS NULL AND w.ltc_address IS NOT NULL)
         OR (p.ltc_deposit_address IS NOT NULL
             AND btrim(w.ltc_address) IS DISTINCT FROM btrim(p.ltc_deposit_address))
    ) THEN
      v_findings := array_append(v_findings, 'Existing wallet rows do not match their owning profile index/address identity');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.user_deposit_addresses AS uda
      LEFT JOIN public.profiles AS p ON p.id = uda.user_id
      WHERE p.id IS NULL
         OR p.wallet_index IS NULL
         OR upper(btrim(uda.asset_symbol)) IS DISTINCT FROM
            CASE upper(btrim(uda.network))
              WHEN 'BTC' THEN 'BTC'
              WHEN 'ETH' THEN 'ETH'
              WHEN 'LTC' THEN 'LTC'
              WHEN 'ERC20' THEN 'USDT'
              WHEN 'BEP20' THEN 'USDT'
              WHEN 'TRC20' THEN 'USDT'
              ELSE NULL
            END
         OR upper(btrim(uda.asset_code)) IS DISTINCT FROM
            CASE upper(btrim(uda.network))
              WHEN 'BTC' THEN 'BTC'
              WHEN 'ETH' THEN 'ETH'
              WHEN 'LTC' THEN 'LTC'
              WHEN 'ERC20' THEN 'USDT'
              WHEN 'BEP20' THEN 'USDT'
              WHEN 'TRC20' THEN 'USDT'
              ELSE NULL
            END
         OR upper(btrim(uda.chain)) IS DISTINCT FROM upper(btrim(uda.network))
         OR upper(btrim(uda.network_code)) IS DISTINCT FROM upper(btrim(uda.network))
         OR (
            CASE upper(btrim(uda.network))
              WHEN 'BTC' THEN btrim(uda.address) IS DISTINCT FROM btrim(p.btc_deposit_address)
              WHEN 'ETH' THEN lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
              WHEN 'LTC' THEN btrim(uda.address) IS DISTINCT FROM btrim(p.ltc_deposit_address)
              WHEN 'ERC20' THEN lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
              WHEN 'BEP20' THEN lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
              WHEN 'TRC20' THEN btrim(uda.address) IS DISTINCT FROM btrim(p.tron_deposit_address)
              ELSE TRUE
            END
         )
         OR (
           uda.derivation_path IS NOT NULL
           AND uda.derivation_path IS DISTINCT FROM
             CASE upper(btrim(uda.network))
               WHEN 'BTC' THEN 'm/84''/0''/0''/0/' || p.wallet_index::TEXT
               WHEN 'ETH' THEN 'm/44''/60''/0''/0/' || p.wallet_index::TEXT
               WHEN 'LTC' THEN 'm/84''/2''/0''/0/' || p.wallet_index::TEXT
               WHEN 'ERC20' THEN 'm/44''/60''/0''/0/' || p.wallet_index::TEXT
               WHEN 'BEP20' THEN 'm/44''/60''/0''/0/' || p.wallet_index::TEXT
               WHEN 'TRC20' THEN 'm/44''/195''/0''/0/' || p.wallet_index::TEXT
               ELSE NULL
             END
         )
    ) THEN
      v_findings := array_append(v_findings, 'Existing user deposit-address rows do not match profile ownership, network, asset, address or derivation path');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.user_deposit_addresses AS uda
      LEFT JOIN public.wallets AS w ON w.id = uda.wallet_id
      WHERE uda.wallet_id IS NOT NULL
        AND (w.id IS NULL OR w.user_id IS DISTINCT FROM uda.user_id)
    ) THEN
      v_findings := array_append(v_findings, 'Existing user deposit-address wallet links do not belong to the same user');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.deposit_addresses AS da
      LEFT JOIN public.wallets AS w ON w.id = da.wallet_id
      LEFT JOIN public.profiles AS p ON p.id = da.user_id
      WHERE w.id IS NULL
         OR w.user_id IS DISTINCT FROM da.user_id
         OR p.id IS NULL
         OR p.wallet_index IS NULL
    ) THEN
      v_findings := array_append(v_findings, 'Existing legacy deposit-address wallet/profile ownership links are incomplete or inconsistent');
    END IF;
  END IF;

  -- 6. Registry rows must not assign one normalized address/network pair to
  --    multiple users. Run only if the required lookup columns exist.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_deposit_addresses' AND column_name = 'user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_deposit_addresses' AND column_name = 'address'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_deposit_addresses' AND column_name = 'network'
  ) THEN
    EXECUTE $query$
      SELECT count(*)
      FROM (
        SELECT
          CASE
            WHEN upper(btrim(network)) IN ('ETH', 'ERC20', 'BEP20', 'BSC')
              THEN lower(btrim(address))
            ELSE btrim(address)
          END AS normalized_address,
          upper(btrim(network)) AS normalized_network
        FROM public.user_deposit_addresses
        WHERE user_id IS NOT NULL
          AND nullif(btrim(address), '') IS NOT NULL
          AND nullif(btrim(network), '') IS NOT NULL
        GROUP BY 1, 2
        HAVING count(DISTINCT user_id) > 1
      ) conflicts
    $query$ INTO v_conflict_count;

    IF v_conflict_count > 0 THEN
      v_findings := array_append(v_findings, 'user_deposit_addresses contains address/network ownership conflicts');
    END IF;
  END IF;

  -- 7. Sensitive settings and hot-wallet nonce state must not be directly
  --    readable/writable by anonymous or authenticated API roles.
  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    WHERE c.oid = 'public.platform_settings'::regclass;

    IF NOT coalesce(v_rls, false)
      OR has_table_privilege('anon', 'public.platform_settings', 'SELECT')
      OR has_table_privilege('anon', 'public.platform_settings', 'INSERT')
      OR has_table_privilege('anon', 'public.platform_settings', 'UPDATE')
      OR has_table_privilege('anon', 'public.platform_settings', 'DELETE')
      OR has_table_privilege('authenticated', 'public.platform_settings', 'SELECT')
      OR has_table_privilege('authenticated', 'public.platform_settings', 'INSERT')
      OR has_table_privilege('authenticated', 'public.platform_settings', 'UPDATE')
      OR has_table_privilege('authenticated', 'public.platform_settings', 'DELETE')
    THEN
      v_findings := array_append(v_findings, 'platform_settings is exposed to anon/authenticated roles or RLS is disabled');
    END IF;
  END IF;

  IF to_regclass('public.hot_wallet_nonces') IS NOT NULL THEN
    SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c
    WHERE c.oid = 'public.hot_wallet_nonces'::regclass;

    IF NOT coalesce(v_rls, false)
      OR has_table_privilege('anon', 'public.hot_wallet_nonces', 'SELECT')
      OR has_table_privilege('anon', 'public.hot_wallet_nonces', 'INSERT')
      OR has_table_privilege('anon', 'public.hot_wallet_nonces', 'UPDATE')
      OR has_table_privilege('anon', 'public.hot_wallet_nonces', 'DELETE')
      OR has_table_privilege('authenticated', 'public.hot_wallet_nonces', 'SELECT')
      OR has_table_privilege('authenticated', 'public.hot_wallet_nonces', 'INSERT')
      OR has_table_privilege('authenticated', 'public.hot_wallet_nonces', 'UPDATE')
      OR has_table_privilege('authenticated', 'public.hot_wallet_nonces', 'DELETE')
    THEN
      v_findings := array_append(v_findings, 'hot_wallet_nonces is exposed to anon/authenticated roles or RLS is disabled');
    END IF;
  END IF;

  IF cardinality(v_findings) > 0 THEN
    RAISE EXCEPTION 'WAYONES wallet registry preflight failed: %', array_to_string(v_findings, '; ');
  END IF;

  RAISE NOTICE 'WAYONES wallet registry reconciliation preflight passed.';
END;
$wallet_registry_reconciliation$;
