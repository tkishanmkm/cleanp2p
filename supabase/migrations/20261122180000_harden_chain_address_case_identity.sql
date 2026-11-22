-- Enforce chain-aware canonical address uniqueness in the existing
-- chain/address/index wallet schema. EVM and Bech32 BTC/LTC addresses are
-- case-insensitive; TRON Base58 addresses are case-sensitive.
-- This migration intentionally does not add wallet_id columns or change the
-- canonical provisioning RPC's chain/address contract.

BEGIN;

DO $wallet_address_identity_preflight$
DECLARE
  v_rpc REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.provision_user_wallets_atomic(uuid,integer,text,text,text,text)'
  );
  v_owner TEXT;
  v_is_definer BOOLEAN;
  v_config TEXT[];
BEGIN
  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'Canonical provision_user_wallets_atomic RPC is missing; refusing address-identity hardening.';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_owner, v_is_definer, v_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_rpc;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_is_definer IS DISTINCT FROM TRUE
     OR NOT (coalesce(v_config, ARRAY[]::TEXT[]) @> ARRAY['search_path=""']::TEXT[])
     OR has_function_privilege('anon', v_rpc, 'EXECUTE')
     OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'Canonical provisioning RPC owner, SECURITY DEFINER, search_path or grants do not match the reviewed service-only contract.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wallets
    WHERE address IS NULL OR pg_catalog.btrim(address) = ''
  ) OR EXISTS (
    SELECT 1
    FROM public.user_deposit_addresses
    WHERE address IS NULL OR pg_catalog.btrim(address) = ''
  ) OR EXISTS (
    SELECT 1
    FROM public.deposit_addresses
    WHERE address IS NULL OR pg_catalog.btrim(address) = ''
  ) THEN
    RAISE EXCEPTION 'Blank wallet/deposit address found; reconcile rows before creating canonical unique indexes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.wallets
    WHERE pg_catalog.upper(chain) NOT IN ('EVM', 'TRON', 'BTC', 'LTC')
  ) OR EXISTS (
    SELECT 1 FROM public.user_deposit_addresses
    WHERE pg_catalog.lower(network::TEXT) NOT IN ('bitcoin', 'ethereum', 'trc20')
  ) OR EXISTS (
    SELECT 1 FROM public.deposit_addresses
    WHERE pg_catalog.lower(network) NOT IN ('bitcoin', 'ethereum', 'litecoin', 'trc20')
  ) THEN
    RAISE EXCEPTION 'Unsupported wallet/address network found; confirm its address-normalization rules before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.wallets
    GROUP BY CASE
      WHEN pg_catalog.upper(chain) = 'TRON' THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Wallets contain duplicate chain-normalized addresses; reconcile before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_deposit_addresses
    GROUP BY CASE
      WHEN pg_catalog.upper(network::TEXT) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'user_deposit_addresses contains duplicate chain-normalized addresses; reconcile before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.deposit_addresses
    GROUP BY CASE
      WHEN pg_catalog.upper(network) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'deposit_addresses contains duplicate chain-normalized addresses; reconcile before migration.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT id AS user_id, pg_catalog.lower(pg_catalog.btrim(evm_deposit_address)) AS normalized_address
      FROM public.profiles
      WHERE evm_deposit_address IS NOT NULL AND pg_catalog.btrim(evm_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.btrim(tron_deposit_address)
      FROM public.profiles
      WHERE tron_deposit_address IS NOT NULL AND pg_catalog.btrim(tron_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.lower(pg_catalog.btrim(btc_deposit_address))
      FROM public.profiles
      WHERE btc_deposit_address IS NOT NULL AND pg_catalog.btrim(btc_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.lower(pg_catalog.btrim(ltc_deposit_address))
      FROM public.profiles
      WHERE ltc_deposit_address IS NOT NULL AND pg_catalog.btrim(ltc_deposit_address) <> ''
    ) profile_addresses
    GROUP BY normalized_address
    HAVING count(*) FILTER (WHERE normalized_address IS NOT NULL) > 1
       AND count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'Profile address mirrors contain cross-user normalized collisions; reconcile before migration.';
  END IF;

  IF EXISTS (
    WITH all_addresses AS (
      SELECT user_id,
        CASE WHEN pg_catalog.upper(chain) = 'TRON' THEN pg_catalog.btrim(address)
             ELSE pg_catalog.lower(pg_catalog.btrim(address)) END AS normalized_address
      FROM public.wallets
      UNION ALL
      SELECT user_id,
        CASE WHEN pg_catalog.upper(network::TEXT) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
             ELSE pg_catalog.lower(pg_catalog.btrim(address)) END
      FROM public.user_deposit_addresses
      UNION ALL
      SELECT user_id,
        CASE WHEN pg_catalog.upper(network) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
             ELSE pg_catalog.lower(pg_catalog.btrim(address)) END
      FROM public.deposit_addresses
      UNION ALL
      SELECT id, pg_catalog.lower(pg_catalog.btrim(evm_deposit_address))
      FROM public.profiles WHERE evm_deposit_address IS NOT NULL AND pg_catalog.btrim(evm_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.btrim(tron_deposit_address)
      FROM public.profiles WHERE tron_deposit_address IS NOT NULL AND pg_catalog.btrim(tron_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.lower(pg_catalog.btrim(btc_deposit_address))
      FROM public.profiles WHERE btc_deposit_address IS NOT NULL AND pg_catalog.btrim(btc_deposit_address) <> ''
      UNION ALL
      SELECT id, pg_catalog.lower(pg_catalog.btrim(ltc_deposit_address))
      FROM public.profiles WHERE ltc_deposit_address IS NOT NULL AND pg_catalog.btrim(ltc_deposit_address) <> ''
    )
    SELECT normalized_address
    FROM all_addresses
    GROUP BY normalized_address
    HAVING count(DISTINCT user_id) > 1
  ) THEN
    RAISE EXCEPTION 'Wallet/address registries contain cross-user normalized address collisions; reconcile before migration.';
  END IF;
END;
$wallet_address_identity_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS wayones_wallets_chain_address_identity_uq
  ON public.wallets (
    CASE
      WHEN pg_catalog.upper(chain) = 'TRON' THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
  );

CREATE UNIQUE INDEX IF NOT EXISTS wayones_user_deposit_addresses_chain_identity_uq
  ON public.user_deposit_addresses (
    CASE
      WHEN pg_catalog.upper(network::TEXT) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
  );

CREATE UNIQUE INDEX IF NOT EXISTS wayones_deposit_addresses_chain_identity_uq
  ON public.deposit_addresses (
    CASE
      WHEN pg_catalog.upper(network) IN ('TRC20', 'TRON') THEN pg_catalog.btrim(address)
      ELSE pg_catalog.lower(pg_catalog.btrim(address))
    END
  );

CREATE UNIQUE INDEX IF NOT EXISTS wayones_profiles_evm_address_ci_uq
  ON public.profiles (pg_catalog.lower(pg_catalog.btrim(evm_deposit_address)))
  WHERE evm_deposit_address IS NOT NULL AND pg_catalog.btrim(evm_deposit_address) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS wayones_profiles_tron_address_cs_uq
  ON public.profiles (pg_catalog.btrim(tron_deposit_address))
  WHERE tron_deposit_address IS NOT NULL AND pg_catalog.btrim(tron_deposit_address) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS wayones_profiles_btc_address_ci_uq
  ON public.profiles (pg_catalog.lower(pg_catalog.btrim(btc_deposit_address)))
  WHERE btc_deposit_address IS NOT NULL AND pg_catalog.btrim(btc_deposit_address) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS wayones_profiles_ltc_address_ci_uq
  ON public.profiles (pg_catalog.lower(pg_catalog.btrim(ltc_deposit_address)))
  WHERE ltc_deposit_address IS NOT NULL AND pg_catalog.btrim(ltc_deposit_address) <> '';

DO $wallet_address_identity_verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.wallets'::REGCLASS, 'wayones_wallets_chain_address_identity_uq'),
        ('public.user_deposit_addresses'::REGCLASS, 'wayones_user_deposit_addresses_chain_identity_uq'),
        ('public.deposit_addresses'::REGCLASS, 'wayones_deposit_addresses_chain_identity_uq'),
        ('public.profiles'::REGCLASS, 'wayones_profiles_evm_address_ci_uq'),
        ('public.profiles'::REGCLASS, 'wayones_profiles_tron_address_cs_uq'),
        ('public.profiles'::REGCLASS, 'wayones_profiles_btc_address_ci_uq'),
        ('public.profiles'::REGCLASS, 'wayones_profiles_ltc_address_ci_uq')
    ) expected(table_ref, index_name)
    LEFT JOIN pg_catalog.pg_class index_class
      ON index_class.relname = expected.index_name
    LEFT JOIN pg_catalog.pg_namespace index_schema
      ON index_schema.oid = index_class.relnamespace
     AND index_schema.nspname = 'public'
    LEFT JOIN pg_catalog.pg_index index_meta
      ON index_meta.indexrelid = index_class.oid
    WHERE index_schema.oid IS NULL
       OR index_meta.indrelid IS DISTINCT FROM expected.table_ref::OID
       OR index_meta.indisunique IS DISTINCT FROM TRUE
       OR index_meta.indisvalid IS DISTINCT FROM TRUE
       OR index_meta.indisready IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION 'Chain-aware address identity indexes are missing, invalid, non-unique or attached to the wrong table.';
  END IF;
END;
$wallet_address_identity_verify$;

COMMENT ON INDEX public.wayones_wallets_chain_address_identity_uq
  IS 'Case-aware uniqueness: EVM/BTC/LTC normalized; TRON Base58 remains case-sensitive.';
COMMENT ON INDEX public.wayones_user_deposit_addresses_chain_identity_uq
  IS 'Case-aware unique canonical physical address across user_deposit_addresses.';
COMMENT ON INDEX public.wayones_deposit_addresses_chain_identity_uq
  IS 'Case-aware unique canonical physical address across legacy deposit_addresses.';

COMMIT;
