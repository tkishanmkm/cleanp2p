-- Step 13: prevent anon/authenticated clients from reading or consuming
-- either wallet-index sequence directly. Allocation remains through the
-- Postgres-owned SECURITY DEFINER claim/signup paths.
-- This migration does not call nextval(), setval(), RESTART or alter a value.
BEGIN;

DO $step_13_sequence_acl$
DECLARE
  v_canonical REGCLASS := pg_catalog.to_regclass('public.user_wallet_index_seq');
  v_legacy REGCLASS := pg_catalog.to_regclass('public.wallet_index_seq');
  v_canonical_owner TEXT;
  v_legacy_owner TEXT;
  v_canonical_service_usage BOOLEAN;
  v_canonical_service_select BOOLEAN;
  v_legacy_service_usage BOOLEAN;
  v_legacy_service_select BOOLEAN;
  v_canonical_last_before BIGINT;
  v_legacy_last_before BIGINT;
  v_canonical_last_after BIGINT;
  v_legacy_last_after BIGINT;
BEGIN
  IF v_canonical IS NULL OR v_legacy IS NULL THEN
    RAISE EXCEPTION
      'Step 13 refused: both canonical user_wallet_index_seq and legacy wallet_index_seq must exist for reviewed ACL hardening.';
  END IF;

  SELECT pg_catalog.pg_get_userbyid(c.relowner)
    INTO v_canonical_owner
  FROM pg_catalog.pg_class c
  WHERE c.oid=v_canonical AND c.relkind='S';

  SELECT pg_catalog.pg_get_userbyid(c.relowner)
    INTO v_legacy_owner
  FROM pg_catalog.pg_class c
  WHERE c.oid=v_legacy AND c.relkind='S';

  IF v_canonical_owner IS DISTINCT FROM 'postgres'
     OR v_legacy_owner IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION
      'Step 13 refused: wallet index sequences are not both owned by postgres.';
  END IF;

  v_canonical_service_usage := pg_catalog.has_sequence_privilege('service_role',v_canonical,'USAGE');
  v_canonical_service_select := pg_catalog.has_sequence_privilege('service_role',v_canonical,'SELECT');
  v_legacy_service_usage := pg_catalog.has_sequence_privilege('service_role',v_legacy,'USAGE');
  v_legacy_service_select := pg_catalog.has_sequence_privilege('service_role',v_legacy,'SELECT');

  IF NOT v_canonical_service_usage
     OR NOT v_canonical_service_select
     OR NOT v_legacy_service_usage
     OR NOT v_legacy_service_select THEN
    RAISE EXCEPTION
      'Step 13 refused: service_role sequence privileges differ from the reviewed live snapshot.';
  END IF;

  EXECUTE 'SELECT last_value FROM public.user_wallet_index_seq'
    INTO v_canonical_last_before;
  EXECUTE 'SELECT last_value FROM public.wallet_index_seq'
    INTO v_legacy_last_before;

  IF v_canonical_last_before < 1 OR v_legacy_last_before < 1 THEN
    RAISE EXCEPTION
      'Step 13 refused: a wallet index sequence has an invalid non-positive watermark.';
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE public.user_wallet_index_seq FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL PRIVILEGES ON SEQUENCE public.wallet_index_seq FROM PUBLIC, anon, authenticated';

  IF pg_catalog.has_sequence_privilege('anon',v_canonical,'USAGE')
     OR pg_catalog.has_sequence_privilege('anon',v_canonical,'SELECT')
     OR pg_catalog.has_sequence_privilege('authenticated',v_canonical,'USAGE')
     OR pg_catalog.has_sequence_privilege('authenticated',v_canonical,'SELECT')
     OR pg_catalog.has_sequence_privilege('anon',v_legacy,'USAGE')
     OR pg_catalog.has_sequence_privilege('anon',v_legacy,'SELECT')
     OR pg_catalog.has_sequence_privilege('authenticated',v_legacy,'USAGE')
     OR pg_catalog.has_sequence_privilege('authenticated',v_legacy,'SELECT') THEN
    RAISE EXCEPTION
      'Step 13 failed postcondition: browser roles retain direct wallet-index sequence access.';
  END IF;

  IF NOT pg_catalog.has_sequence_privilege('service_role',v_canonical,'USAGE')
     OR NOT pg_catalog.has_sequence_privilege('service_role',v_canonical,'SELECT')
     OR NOT pg_catalog.has_sequence_privilege('service_role',v_legacy,'USAGE')
     OR NOT pg_catalog.has_sequence_privilege('service_role',v_legacy,'SELECT')
     OR NOT pg_catalog.has_sequence_privilege('postgres',v_canonical,'USAGE')
     OR NOT pg_catalog.has_sequence_privilege('postgres',v_canonical,'SELECT')
     OR NOT pg_catalog.has_sequence_privilege('postgres',v_legacy,'USAGE')
     OR NOT pg_catalog.has_sequence_privilege('postgres',v_legacy,'SELECT') THEN
    RAISE EXCEPTION
      'Step 13 failed postcondition: service_role or postgres sequence access changed unexpectedly.';
  END IF;

  EXECUTE 'SELECT last_value FROM public.user_wallet_index_seq'
    INTO v_canonical_last_after;
  EXECUTE 'SELECT last_value FROM public.wallet_index_seq'
    INTO v_legacy_last_after;

  IF v_canonical_last_after IS DISTINCT FROM v_canonical_last_before
     OR v_legacy_last_after IS DISTINCT FROM v_legacy_last_before THEN
    RAISE EXCEPTION
      'Step 13 failed postcondition: a sequence watermark changed during ACL hardening.';
  END IF;
END;
$step_13_sequence_acl$;

COMMIT;
