-- Step 06: converge every profile wallet-index allocation path on the
-- already-active user_wallet_index_seq. Do not reset either sequence and do not
-- rewrite existing profile or address rows.
BEGIN;

SET LOCAL lock_timeout = '5s';
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;

DO $step_06_wallet_index_preflight$
DECLARE
  v_user_seq REGCLASS := pg_catalog.to_regclass('public.user_wallet_index_seq');
  v_legacy_seq REGCLASS := pg_catalog.to_regclass('public.wallet_index_seq');
  v_claim_oid OID := pg_catalog.to_regprocedure('public.claim_next_wallet_index()');
  v_handle_oid OID := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_init_oid OID := pg_catalog.to_regprocedure('public.handle_new_user_wallet_init()');
  v_claim_source TEXT;
  v_claim_owner TEXT;
  v_claim_definer BOOLEAN;
  v_claim_config TEXT[];
  v_handle_source TEXT;
  v_handle_owner TEXT;
  v_handle_definer BOOLEAN;
  v_init_source TEXT;
  v_init_owner TEXT;
  v_init_definer BOOLEAN;
  v_init_config TEXT[];
  v_profile_default TEXT;
  v_user_last BIGINT;
  v_user_called BOOLEAN;
  v_user_start BIGINT;
  v_user_increment BIGINT;
  v_legacy_last BIGINT;
  v_legacy_called BOOLEAN;
  v_legacy_start BIGINT;
  v_next_index BIGINT;
  v_max_allocated_index BIGINT;
BEGIN
  IF v_user_seq IS NULL OR v_legacy_seq IS NULL
     OR v_claim_oid IS NULL OR v_handle_oid IS NULL OR v_init_oid IS NULL THEN
    RAISE EXCEPTION
      'Step 06 refused: expected wallet index sequences and profile allocator functions are incomplete.';
  END IF;

  SELECT c.column_default
  INTO v_profile_default
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'profiles'
    AND c.column_name = 'wallet_index';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Step 06 refused: public.profiles.wallet_index is missing.';
  END IF;

  IF v_profile_default IS NOT NULL
     AND position('wallet_index_seq' IN v_profile_default) = 0 THEN
    RAISE EXCEPTION
      'Step 06 refused: profiles.wallet_index has an unreviewed default: %',
      v_profile_default;
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.prosrc
  INTO
    v_claim_owner,
    v_claim_definer,
    v_claim_config,
    v_claim_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_claim_oid;

  IF v_claim_owner IS DISTINCT FROM 'postgres'
     OR v_claim_definer IS DISTINCT FROM TRUE
     OR v_claim_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
     OR position('public.wallet_index_seq' IN v_claim_source) = 0
     OR position('public.user_wallet_index_seq' IN v_claim_source) > 0 THEN
    RAISE EXCEPTION
      'Step 06 refused: claim_next_wallet_index() no longer matches the reviewed legacy allocator contract.';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_claim_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_claim_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Step 06 refused: claim_next_wallet_index() grants differ from the service-role-only contract.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.prosrc
  INTO
    v_handle_owner,
    v_handle_definer,
    v_handle_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_handle_oid;

  IF v_handle_owner IS DISTINCT FROM 'postgres'
     OR v_handle_definer IS DISTINCT FROM TRUE
     OR position('public.user_wallet_index_seq' IN v_handle_source) = 0
     OR position('INSERT INTO public.profiles' IN v_handle_source) = 0 THEN
    RAISE EXCEPTION
      'Step 06 refused: active handle_new_user() no longer allocates from user_wallet_index_seq and creates the profile as reviewed.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.prosrc
  INTO
    v_init_owner,
    v_init_definer,
    v_init_config,
    v_init_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_init_oid;

  IF v_init_owner IS DISTINCT FROM 'postgres'
     OR v_init_definer IS DISTINCT FROM TRUE
     OR v_init_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
     OR position('NEW.wallet_index IS NULL' IN v_init_source) = 0
     OR position('public.claim_next_wallet_index()' IN v_init_source) = 0 THEN
    RAISE EXCEPTION
      'Step 06 refused: profile BEFORE INSERT allocator trigger no longer matches the reviewed contract.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index idx
    WHERE idx.indrelid = 'public.profiles'::REGCLASS
      AND idx.indisunique
      AND idx.indisvalid
      AND idx.indisready
      AND idx.indpred IS NULL
      AND idx.indexprs IS NULL
      AND idx.indnatts = 1
      AND idx.indnkeyatts = 1
      AND pg_catalog.pg_get_indexdef(idx.indexrelid, 1, TRUE) = 'wallet_index'
  ) THEN
    RAISE EXCEPTION
      'Step 06 refused: profiles.wallet_index lacks a valid single-column full unique index.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND t.tgname = 'trg_init_user_wallet'
      AND NOT t.tgisinternal
      AND t.tgfoid = v_init_oid
  ) THEN
    RAISE EXCEPTION
      'Step 06 refused: active profile BEFORE INSERT wallet-index trigger is missing or points to another function.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.column_default ILIKE '%wallet_index_seq%'
      AND NOT (c.table_name = 'profiles' AND c.column_name = 'wallet_index')
  ) THEN
    RAISE EXCEPTION
      'Step 06 refused: another public column default references a wallet-index sequence.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.oid <> v_claim_oid
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%public.wallet_index_seq%'
  ) THEN
    RAISE EXCEPTION
      'Step 06 refused: another public function references the legacy wallet_index_seq.';
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT last_value, is_called FROM %s',
    v_user_seq
  ) INTO v_user_last, v_user_called;

  EXECUTE pg_catalog.format(
    'SELECT last_value, is_called FROM %s',
    v_legacy_seq
  ) INTO v_legacy_last, v_legacy_called;

  SELECT s.seqstart, s.seqincrement
  INTO v_user_start, v_user_increment
  FROM pg_catalog.pg_sequence s
  WHERE s.seqrelid = v_user_seq;

  SELECT s.seqstart
  INTO v_legacy_start
  FROM pg_catalog.pg_sequence s
  WHERE s.seqrelid = v_legacy_seq;

  v_next_index := CASE
    WHEN v_user_called THEN v_user_last + v_user_increment
    ELSE v_user_start
  END;

  SELECT GREATEST(
    COALESCE((SELECT max(p.wallet_index)::BIGINT FROM public.profiles p), 0),
    COALESCE((SELECT max(d.derivation_index)::BIGINT FROM public.deposit_addresses d), 0),
    COALESCE((SELECT max(w.derivation_index)::BIGINT FROM public.wallets w), 0),
    CASE WHEN v_legacy_called THEN v_legacy_last ELSE v_legacy_start END
  )
  INTO v_max_allocated_index;

  IF v_next_index <= 0
     OR v_next_index > 2147483647
     OR v_next_index <= v_max_allocated_index THEN
    RAISE EXCEPTION
      'Step 06 refused: next shared wallet index % is not positive, exceeds int4, or is not above the previously allocated index ceiling %.',
      v_next_index,
      v_max_allocated_index;
  END IF;
END;
$step_06_wallet_index_preflight$;

-- Remove the column default that bypassed the trigger and consumed the legacy
-- sequence. Explicit NULL and omitted values now both go through the trigger.
ALTER TABLE public.profiles
  ALTER COLUMN wallet_index DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.claim_next_wallet_index()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_wallet_index BIGINT;
BEGIN
  v_wallet_index := pg_catalog.nextval('public.user_wallet_index_seq');

  IF v_wallet_index <= 0 OR v_wallet_index > 2147483647 THEN
    RAISE EXCEPTION
      'Wallet index sequence returned an invalid value.'
      USING ERRCODE = '22003';
  END IF;

  RETURN v_wallet_index::INTEGER;
END;
$function$;

ALTER FUNCTION public.claim_next_wallet_index() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.claim_next_wallet_index()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_wallet_index()
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user_wallet_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.wallet_index IS NULL THEN
    NEW.wallet_index := public.claim_next_wallet_index();
  END IF;

  IF NEW.wallet_index IS NULL OR NEW.wallet_index <= 0 THEN
    RAISE EXCEPTION
      'Profile wallet_index must be a positive allocated integer.'
      USING ERRCODE = '22003';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.handle_new_user_wallet_init() OWNER TO postgres;

DO $step_06_wallet_index_postcondition$
DECLARE
  v_claim_source TEXT;
  v_init_source TEXT;
  v_auth_source TEXT;
  v_claim_oid OID := pg_catalog.to_regprocedure('public.claim_next_wallet_index()');
  v_init_oid OID := pg_catalog.to_regprocedure('public.handle_new_user_wallet_init()');
  v_handle_oid OID := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_default TEXT;
BEGIN
  SELECT c.column_default
  INTO v_default
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'profiles'
    AND c.column_name = 'wallet_index';

  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION
      'Step 06 postcondition failed: profiles.wallet_index still has a column default.';
  END IF;

  SELECT p.prosrc INTO v_claim_source
  FROM pg_catalog.pg_proc p WHERE p.oid = v_claim_oid;
  SELECT p.prosrc INTO v_init_source
  FROM pg_catalog.pg_proc p WHERE p.oid = v_init_oid;
  SELECT p.prosrc INTO v_auth_source
  FROM pg_catalog.pg_proc p WHERE p.oid = v_handle_oid;

  IF position('public.user_wallet_index_seq' IN v_claim_source) = 0
     OR position('public.wallet_index_seq' IN v_claim_source) > 0
     OR position('public.claim_next_wallet_index()' IN v_init_source) = 0
     OR position('public.user_wallet_index_seq' IN v_auth_source) = 0
     OR pg_catalog.has_function_privilege('anon', v_claim_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_claim_oid, 'EXECUTE') THEN
    RAISE EXCEPTION
      'Step 06 postcondition failed: profile and auth wallet-index allocators are not converged on the service-restricted shared sequence.';
  END IF;
END;
$step_06_wallet_index_postcondition$;

COMMIT;
