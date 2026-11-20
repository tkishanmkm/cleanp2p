-- Step 11: make non-negative finite wallet bucket accounting a database
-- invariant, including writes performed by service_role or SECURITY DEFINER RPCs.
-- NULL remains equivalent to zero for the historically nullable numeric buckets.
BEGIN;

DO $step_11_wallet_bucket_preflight$
DECLARE
  v_trigger_oid OID;
  v_function_oid REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.sync_wallet_locked_reserved_balances()'
  );
  v_function_owner TEXT;
  v_function_definer BOOLEAN;
  v_function_config TEXT[];
  v_function_source TEXT;
  v_negative_rows BIGINT;
  v_mirror_mismatch_rows BIGINT;
BEGIN
  IF pg_catalog.to_regclass('public.wallet_assets') IS NULL
     OR v_function_oid IS NULL THEN
    RAISE EXCEPTION
      'Step 11 refused: canonical wallet_assets table or reserved/locked synchronization function is missing.';
  END IF;

  SELECT t.oid
    INTO v_trigger_oid
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname='wallet_assets'
    AND t.tgname='trg_sync_wallet_assets_balance'
    AND NOT t.tgisinternal
    AND t.tgenabled <> 'D';

  IF v_trigger_oid IS NULL THEN
    RAISE EXCEPTION
      'Step 11 refused: wallet_assets reserved/locked BEFORE trigger is missing or disabled.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.prosrc
  INTO
    v_function_owner,
    v_function_definer,
    v_function_config,
    v_function_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_function_oid;

  IF v_function_owner IS DISTINCT FROM 'postgres'
     OR v_function_definer IS DISTINCT FROM FALSE
     OR v_function_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::TEXT[]
     OR pg_catalog.strpos(v_function_source,'NEW.reserved_balance := NEW.locked_balance')=0
     OR pg_catalog.strpos(v_function_source,'NEW.locked_balance := NEW.reserved_balance')=0
     OR pg_catalog.strpos(v_function_source,'RETURN NEW')=0 THEN
    RAISE EXCEPTION
      'Step 11 refused: wallet bucket mirror trigger function differs from the reviewed implementation.';
  END IF;

  SELECT count(*) INTO v_negative_rows
  FROM public.wallet_assets wa
  WHERE (wa.balance IS NOT NULL AND (wa.balance < 0 OR wa.balance >= 'Infinity'::NUMERIC))
     OR (wa.locked_balance IS NOT NULL AND (wa.locked_balance < 0 OR wa.locked_balance >= 'Infinity'::NUMERIC))
     OR wa.reserved_balance < 0
     OR wa.reserved_balance >= 'Infinity'::NUMERIC
     OR (wa.in_escrow IS NOT NULL AND (wa.in_escrow < 0 OR wa.in_escrow >= 'Infinity'::NUMERIC))
     OR (wa.in_withdrawal IS NOT NULL AND (wa.in_withdrawal < 0 OR wa.in_withdrawal >= 'Infinity'::NUMERIC));

  SELECT count(*) INTO v_mirror_mismatch_rows
  FROM public.wallet_assets wa
  WHERE coalesce(wa.locked_balance,0) IS DISTINCT FROM wa.reserved_balance;

  IF v_negative_rows <> 0 OR v_mirror_mismatch_rows <> 0 THEN
    RAISE EXCEPTION
      'Step 11 refused: % invalid negative/non-finite bucket rows and % locked/reserved mirror mismatches require reconciliation before constraints can be added.',
      v_negative_rows,
      v_mirror_mismatch_rows;
  END IF;
END;
$step_11_wallet_bucket_preflight$;

DO $step_11_wallet_bucket_constraints$
DECLARE
  v_constraint RECORD;
  v_existing_definition TEXT;
  v_expected_definition TEXT;
BEGIN
  FOR v_constraint IN
    SELECT *
    FROM (VALUES
      (
        'wallet_assets_balance_nonnegative_finite_check',
        '(balance IS NULL OR (balance >= 0 AND balance < ''Infinity''::numeric))'
      ),
      (
        'wallet_assets_locked_nonnegative_finite_check',
        '(locked_balance IS NULL OR (locked_balance >= 0 AND locked_balance < ''Infinity''::numeric))'
      ),
      (
        'wallet_assets_reserved_nonnegative_finite_check',
        '(reserved_balance >= 0 AND reserved_balance < ''Infinity''::numeric)'
      ),
      (
        'wallet_assets_escrow_nonnegative_finite_check',
        '(in_escrow IS NULL OR (in_escrow >= 0 AND in_escrow < ''Infinity''::numeric))'
      ),
      (
        'wallet_assets_withdrawal_nonnegative_finite_check',
        '(in_withdrawal IS NULL OR (in_withdrawal >= 0 AND in_withdrawal < ''Infinity''::numeric))'
      ),
      (
        'wallet_assets_reserved_mirror_check',
        '(COALESCE(locked_balance, 0) = reserved_balance)'
      )
    ) AS expected(name, definition)
  LOOP
    SELECT pg_catalog.pg_get_constraintdef(c.oid)
      INTO v_existing_definition
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.wallet_assets'::REGCLASS
      AND c.conname=v_constraint.name
      AND c.contype='c';

    IF v_existing_definition IS NULL THEN
      EXECUTE pg_catalog.format(
        'ALTER TABLE public.wallet_assets ADD CONSTRAINT %I CHECK %s',
        v_constraint.name,
        v_constraint.definition
      );
    ELSE
      v_expected_definition := 'CHECK ' || v_constraint.definition;
      IF pg_catalog.lower(
           pg_catalog.regexp_replace(v_existing_definition,'[[:space:]]+','','g')
         ) IS DISTINCT FROM pg_catalog.lower(
           pg_catalog.regexp_replace(v_expected_definition,'[[:space:]]+','','g')
         ) THEN
        RAISE EXCEPTION
          'Step 11 refused: existing wallet_assets constraint % has a different definition: %',
          v_constraint.name,
          v_existing_definition;
      END IF;
    END IF;
  END LOOP;
END;
$step_11_wallet_bucket_constraints$;

-- This trigger function only reads NEW/OLD and writes its mirror columns. It
-- does not access application tables, so no user-controlled schema lookup is
-- needed. Preserve its body, owner, SECURITY DEFINER mode and execution ACL.
DO $step_11_trigger_search_path$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.sync_wallet_locked_reserved_balances()'
  );
  v_owner_before TEXT;
  v_definer_before BOOLEAN;
  v_acl_before ACLITEM[];
  v_source_before TEXT;
  v_owner_after TEXT;
  v_definer_after BOOLEAN;
  v_config_after TEXT[];
  v_acl_after ACLITEM[];
  v_source_after TEXT;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proacl,p.prosrc
    INTO v_owner_before,v_definer_before,v_acl_before,v_source_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;

  EXECUTE 'ALTER FUNCTION public.sync_wallet_locked_reserved_balances() SET search_path = ''''';

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,p.prosrc
    INTO v_owner_after,v_definer_after,v_config_after,v_acl_after,v_source_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_source_after IS DISTINCT FROM v_source_before
     OR v_config_after IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: wallet mirror trigger function body, owner, security mode, grants or empty search_path changed unexpectedly.';
  END IF;
END;
$step_11_trigger_search_path$;

DO $step_11_wallet_bucket_postconditions$
DECLARE
  v_expected_count INTEGER := 6;
  v_present_count INTEGER;
  v_invalid_rows BIGINT;
BEGIN
  SELECT count(*)::INTEGER
    INTO v_present_count
  FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.wallet_assets'::REGCLASS
    AND c.contype='c'
    AND c.conname IN (
      'wallet_assets_balance_nonnegative_finite_check',
      'wallet_assets_locked_nonnegative_finite_check',
      'wallet_assets_reserved_nonnegative_finite_check',
      'wallet_assets_escrow_nonnegative_finite_check',
      'wallet_assets_withdrawal_nonnegative_finite_check',
      'wallet_assets_reserved_mirror_check'
    )
    AND c.convalidated IS TRUE;

  IF v_present_count <> v_expected_count THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: expected % validated wallet bucket constraints, found %.',
      v_expected_count,
      v_present_count;
  END IF;

  SELECT count(*) INTO v_invalid_rows
  FROM public.wallet_assets wa
  WHERE (wa.balance IS NOT NULL AND (wa.balance < 0 OR wa.balance >= 'Infinity'::NUMERIC))
     OR (wa.locked_balance IS NOT NULL AND (wa.locked_balance < 0 OR wa.locked_balance >= 'Infinity'::NUMERIC))
     OR wa.reserved_balance < 0
     OR wa.reserved_balance >= 'Infinity'::NUMERIC
     OR (wa.in_escrow IS NOT NULL AND (wa.in_escrow < 0 OR wa.in_escrow >= 'Infinity'::NUMERIC))
     OR (wa.in_withdrawal IS NOT NULL AND (wa.in_withdrawal < 0 OR wa.in_withdrawal >= 'Infinity'::NUMERIC))
     OR coalesce(wa.locked_balance,0) IS DISTINCT FROM wa.reserved_balance;

  IF v_invalid_rows <> 0 THEN
    RAISE EXCEPTION
      'Step 11 failed postcondition: % wallet_assets rows violate non-negative, finite or mirror invariants.',
      v_invalid_rows;
  END IF;
END;
$step_11_wallet_bucket_postconditions$;

COMMIT;
