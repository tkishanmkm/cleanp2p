-- Harden the active auth signup wallet allocator on the existing chain/address
-- schema. The retired handle_new_user_wallets() helper is not an active trigger
-- and must not remain callable as a competing MAX(derivation_index)+1 allocator.
BEGIN;

DO $signup_wallet_allocator_preflight$
DECLARE
  v_signup_oid OID := to_regprocedure('public.handle_new_user()');
  v_legacy_oid OID := to_regprocedure('public.handle_new_user_wallets()');
  v_owner TEXT;
  v_is_definer BOOLEAN;
  v_definition TEXT;
  v_profile_insert_position INTEGER;
BEGIN
  IF v_signup_oid IS NULL THEN
    RAISE EXCEPTION 'Wallet signup hardening refused: public.handle_new_user() is missing.';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef
    INTO v_owner, v_is_definer
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_signup_oid;

  IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Wallet signup hardening refused: handle_new_user() must be postgres-owned SECURITY DEFINER.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'auth.users'::regclass
      AND t.tgname = 'on_auth_user_created'
      AND t.tgfoid = v_signup_oid
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'Wallet signup hardening refused: expected auth.users signup trigger is not attached to handle_new_user().';
  END IF;

  SELECT lower(pg_catalog.pg_get_functiondef(v_signup_oid))
    INTO v_definition;

  v_profile_insert_position := pg_catalog.strpos(v_definition, 'insert into public.profiles');

  IF pg_catalog.strpos(v_definition, $$nextval('public.user_wallet_index_seq'$$) = 0
     OR v_profile_insert_position = 0
     OR pg_catalog.strpos(
       pg_catalog.substring(v_definition FROM v_profile_insert_position),
       'wallet_index'
     ) = 0
     OR pg_catalog.strpos(v_definition, 'public.generate_system_username()') = 0 THEN
    RAISE EXCEPTION 'Wallet signup hardening refused: signup function does not match the reviewed, sequence-backed profile-creation implementation.';
  END IF;

  IF v_legacy_oid IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE t.tgfoid = v_legacy_oid
      AND NOT t.tgisinternal
      AND t.tgenabled IN ('O', 'A')
  ) THEN
    RAISE EXCEPTION 'Wallet signup hardening refused: legacy handle_new_user_wallets() is attached to an active trigger; reconcile the trigger before retirement.';
  END IF;
END;
$signup_wallet_allocator_preflight$;

-- All custom objects called by the reviewed signup function are schema-qualified;
-- built-ins resolve from pg_catalog even with an empty path.
ALTER FUNCTION public.handle_new_user() SET search_path = '';

DO $signup_wallet_allocator_verify$
DECLARE
  v_config TEXT[];
BEGIN
  SELECT p.proconfig INTO v_config
  FROM pg_catalog.pg_proc p
  WHERE p.oid = 'public.handle_new_user()'::regprocedure
    AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    AND p.prosecdef IS TRUE;

  IF v_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION 'Wallet signup hardening verification failed: empty search_path was not persisted.';
  END IF;
END;
$signup_wallet_allocator_verify$;

DO $retire_inactive_wallet_allocator$
BEGIN
  IF to_regprocedure('public.handle_new_user_wallets()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION public.handle_new_user_wallets() FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'COMMENT ON FUNCTION public.handle_new_user_wallets() IS ''Retired legacy signup helper. It is intentionally detached and non-executable because it allocated wallet indexes with MAX(wallets.derivation_index)+1.''';
  END IF;
END;
$retire_inactive_wallet_allocator$;

COMMENT ON FUNCTION public.handle_new_user()
  IS 'Auth signup trigger. Uses the unified user_wallet_index_seq and runs with an empty search_path.';

COMMIT;
