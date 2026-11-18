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
  v_function_definition TEXT;
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
      ('wallet_provisioning', 'idempotency_key')
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

  -- 5. Verify the provisioning RPC cannot reassign an existing address to a
  --    different user through ON CONFLICT ... DO UPDATE SET user_id.
  IF v_provision_oid IS NOT NULL THEN
    SELECT pg_get_functiondef(v_provision_oid) INTO v_function_definition;

    IF v_function_definition ~* 'DO UPDATE SET[[:space:]]+user_id[[:space:]]*=[[:space:]]*EXCLUDED\.user_id' THEN
      v_findings := array_append(v_findings, 'provision_user_wallets_atomic() can overwrite the owner of an existing deposit address');
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
      v_findings := array_append(v_findings, 'provision_user_wallets_atomic() uses ON CONFLICT(address, network) without a matching simple unique index; a normalized expression index is not a valid inference target');
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
