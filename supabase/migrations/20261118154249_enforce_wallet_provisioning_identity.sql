-- WAYONES wallet provisioning identity and ownership guards.
-- This is a forward-only DDL migration. It does not backfill, rederive, or
-- rewrite any customer wallet/address rows. It fails closed on schema drift,
-- duplicate identities, unsafe allocator grants, or a lagging index sequence.

BEGIN;

DO $wallet_provisioning_identity_preflight$
DECLARE
  v_missing_columns TEXT;
  v_max_profile_index BIGINT;
  v_sequence_last BIGINT;
  v_sequence_called BOOLEAN;
  v_sequence_increment BIGINT;
  v_next_index BIGINT;
  v_claim_oid OID := to_regprocedure('public.claim_next_wallet_index()');
  v_assign_oid OID := to_regprocedure('public.assign_missing_profile_wallet_indexes()');
  v_provision_oid OID := to_regprocedure(
    'public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)'
  );
  v_signup_wallet_oid OID := to_regprocedure('public.handle_new_user_wallets()');
  v_signup_profile_oid OID := to_regprocedure('public.handle_new_user()');
  v_provision_config TEXT[];
  v_signup_wallet_owner TEXT;
  v_signup_wallet_is_definer BOOLEAN;
  v_signup_wallet_definition TEXT;
  v_wallet_insert_position INTEGER;
  v_profile_insert_position INTEGER;
BEGIN
  WITH required_columns(table_name, column_name) AS (
    VALUES
      ('profiles', 'id'),
      ('profiles', 'wallet_index'),
      ('profiles', 'evm_deposit_address'),
      ('profiles', 'tron_deposit_address'),
      ('profiles', 'btc_deposit_address'),
      ('profiles', 'ltc_deposit_address'),
      ('wallets', 'id'),
      ('wallets', 'user_id'),
      ('wallets', 'wallet_index'),
      ('wallets', 'evm_address'),
      ('wallets', 'tron_address'),
      ('wallets', 'btc_address'),
      ('wallets', 'ltc_address'),
      ('user_deposit_addresses', 'user_id'),
      ('user_deposit_addresses', 'wallet_id'),
      ('user_deposit_addresses', 'address'),
      ('user_deposit_addresses', 'network'),
      ('user_deposit_addresses', 'asset_symbol'),
      ('user_deposit_addresses', 'chain'),
      ('user_deposit_addresses', 'asset_code'),
      ('user_deposit_addresses', 'network_code'),
      ('user_deposit_addresses', 'derivation_path'),
      ('deposit_addresses', 'user_id'),
      ('deposit_addresses', 'wallet_id'),
      ('deposit_addresses', 'address'),
      ('deposit_addresses', 'asset_code'),
      ('deposit_addresses', 'network_code'),
      ('deposit_addresses', 'derivation_path')
  )
  SELECT string_agg(
    required_columns.table_name || '.' || required_columns.column_name,
    ', ' ORDER BY required_columns.table_name, required_columns.column_name
  )
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
    RAISE EXCEPTION
      'Wallet identity migration refused: required columns are missing: %',
      v_missing_columns;
  END IF;

  IF to_regclass('public.user_wallet_index_seq') IS NULL THEN
    RAISE EXCEPTION 'Wallet identity migration refused: public.user_wallet_index_seq is missing.';
  END IF;

  IF v_claim_oid IS NULL OR v_assign_oid IS NULL OR v_provision_oid IS NULL THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: one or more canonical wallet-index/provisioning RPCs are missing.';
  END IF;

  IF has_function_privilege('anon', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_assign_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_assign_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_assign_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_provision_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_provision_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_provision_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: allocator/provisioning RPC grants are not service-role-only.';
  END IF;

  SELECT p.proconfig
  INTO v_provision_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_provision_oid
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND p.prosecdef IS TRUE;

  IF v_provision_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: provisioning RPC must be postgres-owned SECURITY DEFINER with an empty search_path.';
  END IF;
  -- A legacy signup helper may create a wallet row before its profile. The
  -- wallet identity trigger below requires the profile row to exist, so stop
  -- rather than partially breaking signup when that helper uses wallet-first
  -- ordering. Its body must be reconciled before this migration can proceed.
  IF v_signup_wallet_oid IS NOT NULL THEN
    SELECT
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef
    INTO
      v_signup_wallet_owner,
      v_signup_wallet_is_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_signup_wallet_oid;

    IF v_signup_wallet_owner IS DISTINCT FROM 'postgres'
       OR v_signup_wallet_is_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Wallet identity migration refused: public.handle_new_user_wallets() must be postgres-owned SECURITY DEFINER so signup can write protected wallet identity.';
    END IF;

    SELECT lower(pg_catalog.pg_get_functiondef(v_signup_wallet_oid))
    INTO v_signup_wallet_definition;

    v_wallet_insert_position := pg_catalog.strpos(
      v_signup_wallet_definition,
      'insert into public.wallets'
    );
    v_profile_insert_position := pg_catalog.strpos(
      v_signup_wallet_definition,
      'insert into public.profiles'
    );

    IF v_wallet_insert_position > 0
       AND (
         v_profile_insert_position = 0
         OR v_wallet_insert_position < v_profile_insert_position
       ) THEN
      RAISE EXCEPTION
        'Wallet identity migration refused: public.handle_new_user_wallets() inserts wallet rows before profile rows; signup ordering must be reconciled first.';
    END IF;
  END IF;

  IF v_signup_profile_oid IS NOT NULL THEN
    SELECT
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef
    INTO
      v_signup_wallet_owner,
      v_signup_wallet_is_definer
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_signup_profile_oid;

    IF v_signup_wallet_owner IS DISTINCT FROM 'postgres'
       OR v_signup_wallet_is_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION
        'Wallet identity migration refused: public.handle_new_user() must be postgres-owned SECURITY DEFINER so auth signup can assign wallet identity.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT wallet_index
    FROM public.profiles
    WHERE wallet_index IS NOT NULL
    GROUP BY wallet_index
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: duplicate non-null profiles.wallet_index values exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_deposit_addresses
    GROUP BY address, network
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: duplicate exact address/network registry rows exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        CASE
          WHEN upper(btrim(network)) IN ('ETH', 'ERC20', 'BEP20')
            THEN lower(btrim(address))
          ELSE btrim(address)
        END AS normalized_address,
        upper(btrim(network)) AS normalized_network
      FROM public.user_deposit_addresses
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) collisions
  ) THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: normalized address/network collisions exist; reconcile them manually before adding the unique index.';
  END IF;

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
    RAISE EXCEPTION
      'Wallet identity migration refused: existing wallet rows do not match the owning profile index/address identity.';
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
            WHEN 'BTC' THEN
              btrim(uda.address) IS DISTINCT FROM btrim(p.btc_deposit_address)
            WHEN 'ETH' THEN
              lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
            WHEN 'LTC' THEN
              btrim(uda.address) IS DISTINCT FROM btrim(p.ltc_deposit_address)
            WHEN 'ERC20' THEN
              lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
            WHEN 'BEP20' THEN
              lower(btrim(uda.address)) IS DISTINCT FROM lower(btrim(p.evm_deposit_address))
            WHEN 'TRC20' THEN
              btrim(uda.address) IS DISTINCT FROM btrim(p.tron_deposit_address)
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
    RAISE EXCEPTION
      'Wallet identity migration refused: existing user deposit-address rows do not match profile ownership, canonical network, asset, address or derivation path.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_deposit_addresses AS uda
    LEFT JOIN public.wallets AS w ON w.id = uda.wallet_id
    WHERE uda.wallet_id IS NOT NULL
      AND (w.id IS NULL OR w.user_id IS DISTINCT FROM uda.user_id)
  ) THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: user deposit-address wallet links do not belong to the same user.';
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
    RAISE EXCEPTION
      'Wallet identity migration refused: legacy deposit-address rows have missing or cross-user wallet/profile ownership links.';
  END IF;

  SELECT coalesce(max(wallet_index), 0)
  INTO v_max_profile_index
  FROM public.profiles;

  EXECUTE
    'SELECT last_value, is_called FROM public.user_wallet_index_seq'
  INTO v_sequence_last, v_sequence_called;

  SELECT increment_by
  INTO v_sequence_increment
  FROM pg_catalog.pg_sequences
  WHERE schemaname = 'public'
    AND sequencename = 'user_wallet_index_seq';

  IF v_sequence_increment IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: user_wallet_index_seq must increment by exactly one.';
  END IF;

  v_next_index := CASE
    WHEN v_sequence_called THEN v_sequence_last + v_sequence_increment
    ELSE v_sequence_last
  END;

  IF v_next_index <= v_max_profile_index THEN
    RAISE EXCEPTION
      'Wallet identity migration refused: next wallet index % is not above the largest assigned profile index %; reconcile the sequence first.',
      v_next_index,
      v_max_profile_index;
  END IF;
END;
$wallet_provisioning_identity_preflight$;

-- The older RPC uses ON CONFLICT (address, network). Keep a matching simple
-- unique index for inference, while the normalized index separately prevents
-- EVM case variants from being assigned as different addresses.
DO $wallet_provisioning_identity_indexes$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index idx
    WHERE idx.indrelid = 'public.profiles'::regclass
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = 1
      AND idx.indnkeyatts = 1
      AND pg_catalog.pg_get_indexdef(idx.indexrelid, 1, true) = 'wallet_index'
  ) THEN
    CREATE UNIQUE INDEX wayones_profiles_wallet_index_unique
      ON public.profiles (wallet_index);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index idx
    WHERE idx.indrelid = 'public.user_deposit_addresses'::regclass
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = 2
      AND idx.indnkeyatts = 2
      AND pg_catalog.pg_get_indexdef(idx.indexrelid, 1, true) = 'address'
      AND pg_catalog.pg_get_indexdef(idx.indexrelid, 2, true) = 'network'
  ) THEN
    CREATE UNIQUE INDEX wayones_user_deposit_addresses_address_network_unique
      ON public.user_deposit_addresses (address, network);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index idx
    WHERE idx.indrelid = 'public.user_deposit_addresses'::regclass
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indnatts = 2
      AND idx.indnkeyatts = 2
      AND pg_catalog.pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%CASE WHEN%'
      AND pg_catalog.pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%lower(btrim(address))%'
      AND pg_catalog.pg_get_expr(idx.indexprs, idx.indrelid) ILIKE '%upper(btrim(network))%'
  ) THEN
    CREATE UNIQUE INDEX wayones_user_deposit_addresses_normalized_unique
      ON public.user_deposit_addresses (
        (
          CASE
            WHEN upper(btrim(network)) IN ('ETH', 'ERC20', 'BEP20')
              THEN lower(btrim(address))
            ELSE btrim(address)
          END
        ),
        (upper(btrim(network)))
      );
  END IF;
END;
$wallet_provisioning_identity_indexes$;

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.guard_profile_wallet_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.wallet_index IS NOT NULL
     AND (NEW.wallet_index < 1 OR NEW.wallet_index > 2147483647) THEN
    RAISE EXCEPTION 'Wallet index must be a positive signed 32-bit integer.'
      USING ERRCODE = '23514';
  END IF;

  -- Wallet identity can only be assigned by the trusted signup trigger or a
  -- service-role/database provisioning path, never by a browser profile update.
  IF current_user NOT IN ('postgres', 'service_role') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.wallet_index IS NOT NULL
         OR nullif(btrim(NEW.evm_deposit_address), '') IS NOT NULL
         OR nullif(btrim(NEW.tron_deposit_address), '') IS NOT NULL
         OR nullif(btrim(NEW.btc_deposit_address), '') IS NOT NULL
         OR nullif(btrim(NEW.ltc_deposit_address), '') IS NOT NULL THEN
        RAISE EXCEPTION 'Wallet identity fields can only be assigned by the trusted provisioning path.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF (
      OLD.wallet_index IS DISTINCT FROM NEW.wallet_index
      OR OLD.evm_deposit_address IS DISTINCT FROM NEW.evm_deposit_address
      OR OLD.tron_deposit_address IS DISTINCT FROM NEW.tron_deposit_address
      OR OLD.btc_deposit_address IS DISTINCT FROM NEW.btc_deposit_address
      OR OLD.ltc_deposit_address IS DISTINCT FROM NEW.ltc_deposit_address
    ) THEN
      RAISE EXCEPTION 'Wallet identity fields can only be changed by the trusted provisioning path.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'A profile primary-key identity cannot be changed.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.wallet_index IS NOT NULL
       AND NEW.wallet_index IS DISTINCT FROM OLD.wallet_index THEN
      RAISE EXCEPTION 'An assigned profile wallet_index is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.evm_deposit_address), '') IS NOT NULL
       AND lower(btrim(NEW.evm_deposit_address))
           IS DISTINCT FROM lower(btrim(OLD.evm_deposit_address)) THEN
      RAISE EXCEPTION 'An assigned profile EVM deposit address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.tron_deposit_address), '') IS NOT NULL
       AND btrim(NEW.tron_deposit_address)
           IS DISTINCT FROM btrim(OLD.tron_deposit_address) THEN
      RAISE EXCEPTION 'An assigned profile TRON deposit address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.btc_deposit_address), '') IS NOT NULL
       AND btrim(NEW.btc_deposit_address)
           IS DISTINCT FROM btrim(OLD.btc_deposit_address) THEN
      RAISE EXCEPTION 'An assigned profile BTC deposit address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.ltc_deposit_address), '') IS NOT NULL
       AND btrim(NEW.ltc_deposit_address)
           IS DISTINCT FROM btrim(OLD.ltc_deposit_address) THEN
      RAISE EXCEPTION 'An assigned profile LTC deposit address is immutable.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_wallet_row_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_profile RECORD;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Wallet identity changes require the trusted provisioning path.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Wallet primary-key identity cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    p.wallet_index,
    p.evm_deposit_address,
    p.tron_deposit_address,
    p.btc_deposit_address,
    p.ltc_deposit_address
  INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet row must reference an existing profile.'
      USING ERRCODE = '23503';
  END IF;

  IF v_profile.wallet_index IS NULL
     OR NEW.wallet_index IS DISTINCT FROM v_profile.wallet_index THEN
    RAISE EXCEPTION 'Wallet index must exactly match the assigned profile wallet_index.'
      USING ERRCODE = '23514';
  END IF;

  IF lower(btrim(NEW.evm_address))
       IS DISTINCT FROM lower(btrim(v_profile.evm_deposit_address)) THEN
    RAISE EXCEPTION 'Wallet EVM address must exactly match the assigned profile address.'
      USING ERRCODE = '23514';
  END IF;

  IF btrim(NEW.tron_address)
       IS DISTINCT FROM btrim(v_profile.tron_deposit_address) THEN
    RAISE EXCEPTION 'Wallet TRON address must exactly match the assigned profile address.'
      USING ERRCODE = '23514';
  END IF;

  IF btrim(NEW.btc_address)
       IS DISTINCT FROM btrim(v_profile.btc_deposit_address) THEN
    RAISE EXCEPTION 'Wallet BTC address must exactly match the assigned profile address.'
      USING ERRCODE = '23514';
  END IF;

  IF btrim(NEW.ltc_address)
       IS DISTINCT FROM btrim(v_profile.ltc_deposit_address) THEN
    RAISE EXCEPTION 'Wallet LTC address must exactly match the assigned profile address.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Wallet ownership cannot be reassigned.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.wallet_index IS NOT NULL
       AND NEW.wallet_index IS DISTINCT FROM OLD.wallet_index THEN
      RAISE EXCEPTION 'An assigned wallet index is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.evm_address), '') IS NOT NULL
       AND lower(btrim(NEW.evm_address))
           IS DISTINCT FROM lower(btrim(OLD.evm_address)) THEN
      RAISE EXCEPTION 'An assigned wallet EVM address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.tron_address), '') IS NOT NULL
       AND btrim(NEW.tron_address) IS DISTINCT FROM btrim(OLD.tron_address) THEN
      RAISE EXCEPTION 'An assigned wallet TRON address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.btc_address), '') IS NOT NULL
       AND btrim(NEW.btc_address) IS DISTINCT FROM btrim(OLD.btc_address) THEN
      RAISE EXCEPTION 'An assigned wallet BTC address is immutable.'
        USING ERRCODE = '23514';
    END IF;

    IF nullif(btrim(OLD.ltc_address), '') IS NOT NULL
       AND btrim(NEW.ltc_address) IS DISTINCT FROM btrim(OLD.ltc_address) THEN
      RAISE EXCEPTION 'An assigned wallet LTC address is immutable.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_user_deposit_address_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_profile RECORD;
  v_wallet_user_id UUID;
  v_network TEXT;
  v_expected_asset TEXT;
  v_expected_address TEXT;
  v_expected_path TEXT;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'User deposit-address identity changes require the trusted provisioning path.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'User deposit-address primary-key identity cannot be changed.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS DISTINCT FROM NEW.user_id
       OR OLD.address IS DISTINCT FROM NEW.address
       OR upper(btrim(OLD.network)) IS DISTINCT FROM upper(btrim(NEW.network))
       OR upper(btrim(OLD.asset_symbol)) IS DISTINCT FROM upper(btrim(NEW.asset_symbol))
       OR upper(btrim(OLD.asset_code)) IS DISTINCT FROM upper(btrim(NEW.asset_code))
       OR upper(btrim(OLD.chain)) IS DISTINCT FROM upper(btrim(NEW.chain))
       OR upper(btrim(OLD.network_code)) IS DISTINCT FROM upper(btrim(NEW.network_code))
       OR nullif(btrim(OLD.derivation_path), '') IS NOT NULL
          AND NEW.derivation_path IS DISTINCT FROM OLD.derivation_path THEN
      RAISE EXCEPTION 'A registered user deposit address identity cannot be changed or reassigned.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.wallet_id IS NOT NULL
       AND NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
      RAISE EXCEPTION 'A registered user deposit address wallet link is immutable once assigned.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.wallet_id IS NULL AND NEW.wallet_id IS NOT NULL THEN
      SELECT w.user_id INTO v_wallet_user_id
      FROM public.wallets AS w
      WHERE w.id = NEW.wallet_id
      FOR UPDATE;

      IF NOT FOUND OR v_wallet_user_id IS DISTINCT FROM NEW.user_id THEN
        RAISE EXCEPTION 'Deposit address wallet link must belong to the same user.'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  IF NEW.user_id IS NULL OR nullif(btrim(NEW.address), '') IS NULL THEN
    RAISE EXCEPTION 'User deposit address requires a user and non-empty address.'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    p.wallet_index,
    p.evm_deposit_address,
    p.tron_deposit_address,
    p.btc_deposit_address,
    p.ltc_deposit_address
  INTO v_profile
  FROM public.profiles AS p
  WHERE p.id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_profile.wallet_index IS NULL OR v_profile.wallet_index < 1 THEN
    RAISE EXCEPTION 'User deposit address requires an assigned profile wallet index.'
      USING ERRCODE = '23514';
  END IF;

  v_network := upper(btrim(NEW.network));

  CASE v_network
    WHEN 'BTC' THEN
      v_expected_asset := 'BTC';
      v_expected_address := v_profile.btc_deposit_address;
      v_expected_path := 'm/84''/0''/0''/0/' || v_profile.wallet_index::TEXT;
    WHEN 'ETH' THEN
      v_expected_asset := 'ETH';
      v_expected_address := v_profile.evm_deposit_address;
      v_expected_path := 'm/44''/60''/0''/0/' || v_profile.wallet_index::TEXT;
    WHEN 'LTC' THEN
      v_expected_asset := 'LTC';
      v_expected_address := v_profile.ltc_deposit_address;
      v_expected_path := 'm/84''/2''/0''/0/' || v_profile.wallet_index::TEXT;
    WHEN 'ERC20' THEN
      v_expected_asset := 'USDT';
      v_expected_address := v_profile.evm_deposit_address;
      v_expected_path := 'm/44''/60''/0''/0/' || v_profile.wallet_index::TEXT;
    WHEN 'BEP20' THEN
      v_expected_asset := 'USDT';
      v_expected_address := v_profile.evm_deposit_address;
      v_expected_path := 'm/44''/60''/0''/0/' || v_profile.wallet_index::TEXT;
    WHEN 'TRC20' THEN
      v_expected_asset := 'USDT';
      v_expected_address := v_profile.tron_deposit_address;
      v_expected_path := 'm/44''/195''/0''/0/' || v_profile.wallet_index::TEXT;
    ELSE
      RAISE EXCEPTION 'Unsupported user deposit address network: %', v_network
        USING ERRCODE = '23514';
  END CASE;

  IF upper(btrim(NEW.asset_symbol)) IS DISTINCT FROM v_expected_asset
     OR upper(btrim(NEW.asset_code)) IS DISTINCT FROM v_expected_asset
     OR upper(btrim(NEW.chain)) IS DISTINCT FROM v_network
     OR upper(btrim(NEW.network_code)) IS DISTINCT FROM v_network
     OR NEW.derivation_path IS DISTINCT FROM v_expected_path
     OR v_expected_address IS NULL
     OR (
       CASE
         WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
           THEN lower(btrim(NEW.address)) IS DISTINCT FROM lower(btrim(v_expected_address))
         ELSE btrim(NEW.address) IS DISTINCT FROM btrim(v_expected_address)
       END
     ) THEN
    RAISE EXCEPTION
      'User deposit address does not match the profile wallet index, canonical network, asset or derivation path.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.wallet_id IS NOT NULL THEN
    SELECT w.user_id INTO v_wallet_user_id
    FROM public.wallets AS w
    WHERE w.id = NEW.wallet_id
    FOR UPDATE;

    IF NOT FOUND OR v_wallet_user_id IS DISTINCT FROM NEW.user_id THEN
      RAISE EXCEPTION 'Deposit address wallet link must belong to the same user.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.guard_deposit_address_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_wallet_user_id UUID;
  v_profile_wallet_index INTEGER;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Deposit-address identity changes require the trusted provisioning path.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.id IS DISTINCT FROM NEW.id
       OR OLD.user_id IS DISTINCT FROM NEW.user_id
       OR OLD.address IS DISTINCT FROM NEW.address
       OR upper(btrim(OLD.asset_code)) IS DISTINCT FROM upper(btrim(NEW.asset_code))
       OR upper(btrim(OLD.network_code)) IS DISTINCT FROM upper(btrim(NEW.network_code))
       OR nullif(btrim(OLD.derivation_path), '') IS NOT NULL
          AND NEW.derivation_path IS DISTINCT FROM OLD.derivation_path THEN
      RAISE EXCEPTION 'A registered deposit address identity cannot be changed or reassigned.'
        USING ERRCODE = '23514';
    END IF;

    IF OLD.wallet_id IS NOT NULL
       AND NEW.wallet_id IS DISTINCT FROM OLD.wallet_id THEN
      RAISE EXCEPTION 'A registered deposit address wallet link is immutable once assigned.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.user_id IS NULL
     OR NEW.wallet_id IS NULL
     OR nullif(btrim(NEW.address), '') IS NULL THEN
    RAISE EXCEPTION 'Deposit address requires a user, wallet and non-empty address.'
      USING ERRCODE = '23514';
  END IF;

  SELECT p.wallet_index
  INTO v_profile_wallet_index
  FROM public.profiles AS p
  WHERE p.id = NEW.user_id
  FOR UPDATE;

  IF NOT FOUND OR v_profile_wallet_index IS NULL OR v_profile_wallet_index < 1 THEN
    RAISE EXCEPTION 'Deposit address requires an existing profile with an assigned wallet index.'
      USING ERRCODE = '23514';
  END IF;

  SELECT w.user_id
  INTO v_wallet_user_id
  FROM public.wallets AS w
  WHERE w.id = NEW.wallet_id
  FOR UPDATE;

  IF NOT FOUND OR v_wallet_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Deposit address wallet link must belong to the same user.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION private.guard_profile_wallet_identity() OWNER TO postgres;
ALTER FUNCTION private.guard_wallet_row_identity() OWNER TO postgres;
ALTER FUNCTION private.guard_user_deposit_address_identity() OWNER TO postgres;
ALTER FUNCTION private.guard_deposit_address_identity() OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION private.guard_profile_wallet_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.guard_wallet_row_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.guard_user_deposit_address_identity()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION private.guard_deposit_address_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS wayones_profile_wallet_identity_guard ON public.profiles;
CREATE TRIGGER wayones_profile_wallet_identity_guard
  BEFORE INSERT OR UPDATE OF
    id,
    wallet_index,
    evm_deposit_address,
    tron_deposit_address,
    btc_deposit_address,
    ltc_deposit_address
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_profile_wallet_identity();

DROP TRIGGER IF EXISTS wayones_wallet_identity_guard ON public.wallets;
CREATE TRIGGER wayones_wallet_identity_guard
  BEFORE INSERT OR UPDATE OF
    id,
    user_id,
    wallet_index,
    evm_address,
    tron_address,
    btc_address,
    ltc_address
  ON public.wallets
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_wallet_row_identity();

DROP TRIGGER IF EXISTS wayones_user_deposit_address_identity_guard
  ON public.user_deposit_addresses;
CREATE TRIGGER wayones_user_deposit_address_identity_guard
  BEFORE INSERT OR UPDATE OF
    id,
    user_id,
    wallet_id,
    address,
    network,
    asset_symbol,
    chain,
    asset_code,
    network_code,
    derivation_path
  ON public.user_deposit_addresses
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_user_deposit_address_identity();

DROP TRIGGER IF EXISTS wayones_deposit_address_identity_guard
  ON public.deposit_addresses;
CREATE TRIGGER wayones_deposit_address_identity_guard
  BEFORE INSERT OR UPDATE OF
    id,
    user_id,
    wallet_id,
    address,
    asset_code,
    network_code,
    derivation_path
  ON public.deposit_addresses
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_deposit_address_identity();

DO $wallet_provisioning_identity_verify$
DECLARE
  v_missing_trigger_count INTEGER;
BEGIN
  SELECT count(*)
  INTO v_missing_trigger_count
  FROM (
    VALUES
      ('profiles'::TEXT, 'wayones_profile_wallet_identity_guard'::TEXT),
      ('wallets'::TEXT, 'wayones_wallet_identity_guard'::TEXT),
      ('user_deposit_addresses'::TEXT, 'wayones_user_deposit_address_identity_guard'::TEXT),
      ('deposit_addresses'::TEXT, 'wayones_deposit_address_identity_guard'::TEXT)
  ) expected(table_name, trigger_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = expected.table_name
      AND t.tgname = expected.trigger_name
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
  );

  IF v_missing_trigger_count <> 0 THEN
    RAISE EXCEPTION 'Wallet identity guard trigger installation verification failed.';
  END IF;
END;
$wallet_provisioning_identity_verify$;

COMMIT;
