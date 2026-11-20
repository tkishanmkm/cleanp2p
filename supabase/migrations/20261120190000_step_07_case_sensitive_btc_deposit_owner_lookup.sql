-- Step 07: Bitcoin address ownership is case-sensitive (Base58 addresses
-- and mixed-case address strings must never be matched by lowercasing).
-- The live function has four lower-case BTC owner lookups: both count/select
-- lookups in user_deposit_addresses and both count/select lookups in wallets.
-- This source patch is intentionally guarded and changes no customer rows.
BEGIN;

DO $step_07_btc_address_identity$
DECLARE
  v_signature REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
  );
  v_definition TEXT;
  v_updated TEXT;
  v_old TEXT := 'AND LOWER(BTRIM(address)) = LOWER(v_address)';
  v_new TEXT := 'AND BTRIM(address) = v_address';
  v_btc_start INTEGER;
  v_eth_start INTEGER;
  v_btc_section TEXT;
  v_btc_matches INTEGER;
  v_total_matches INTEGER;
  v_updated_matches INTEGER;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION
      'Step 07 refused: canonical process_deposit_atomic signature is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_signature
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION
      'Step 07 refused: canonical process_deposit_atomic must be postgres-owned SECURITY DEFINER with search_path=pg_catalog. Install the confirmation-contract and function-hardening migrations first.';
  END IF;

  v_definition := pg_catalog.pg_get_functiondef(v_signature);
  v_btc_start := pg_catalog.strpos(v_definition, 'IF v_network = ''BTC'' THEN');
  v_eth_start := pg_catalog.strpos(v_definition, 'ELSIF v_network = ''ETH'' THEN');

  IF v_btc_start = 0 OR v_eth_start <= v_btc_start THEN
    RAISE EXCEPTION
      'Step 07 refused: Bitcoin/Ethereum ownership branch markers are missing or reordered.';
  END IF;

  v_btc_section := pg_catalog.substr(v_definition, v_btc_start, v_eth_start - v_btc_start);
  v_btc_matches :=
    (pg_catalog.length(v_btc_section)
      - pg_catalog.length(pg_catalog.replace(v_btc_section, v_old, '')))
    / pg_catalog.length(v_old);
  v_total_matches :=
    (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
    / pg_catalog.length(v_old);

  IF v_btc_matches <> 4 OR v_total_matches <> 4 THEN
    RAISE EXCEPTION
      'Step 07 refused: expected exactly four case-insensitive address comparisons inside the BTC branch, found BTC=% total=%.',
      v_btc_matches,
      v_total_matches;
  END IF;

  v_updated := pg_catalog.replace(v_definition, v_old, v_new);
  v_updated_matches :=
    (pg_catalog.length(v_updated)
      - pg_catalog.length(pg_catalog.replace(v_updated, v_new, '')))
    / pg_catalog.length(v_new);

  IF pg_catalog.strpos(v_updated, v_old) > 0
     OR v_updated_matches < 4 THEN
    RAISE EXCEPTION
      'Step 07 failed postcondition: all four Bitcoin address comparisons were not converted to exact string equality.';
  END IF;

  EXECUTE v_updated;
END;
$step_07_btc_address_identity$;

COMMIT;
