-- Read-only regression check for the on-chain deposit terminal status.
-- Run against a staging database after applying migrations.
-- This checks schema/function consistency; it does not move funds or create deposits.
DO $$
DECLARE
  v_constraint text;
  v_function regprocedure;
  v_definition text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_constraint
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'onchain_deposits'
    AND c.conname = 'onchain_deposits_status_check';

  IF v_constraint IS NULL THEN
    RAISE EXCEPTION 'FAIL: public.onchain_deposits status constraint is missing';
  END IF;

  IF position('CREDITED' IN upper(v_constraint)) = 0 THEN
    RAISE EXCEPTION 'FAIL: onchain_deposits_status_check does not allow CREDITED; definition: %', v_constraint;
  END IF;

  IF position('PENDING' IN upper(v_constraint)) = 0
     OR position('CONFIRMED' IN upper(v_constraint)) = 0
     OR position('FAILED' IN upper(v_constraint)) = 0 THEN
    RAISE EXCEPTION 'FAIL: status constraint must preserve PENDING, CONFIRMED, and FAILED; definition: %', v_constraint;
  END IF;

  v_function := to_regprocedure('public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)');
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'FAIL: expected process_deposit_atomic signature is missing';
  END IF;

  SELECT pg_get_functiondef(v_function) INTO v_definition;
  IF position('CREDITED' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'FAIL: process_deposit_atomic does not contain CREDITED finalization';
  END IF;

  RAISE NOTICE 'PASS: on-chain deposit status constraint permits CREDITED and preserves existing states';
END;
$$;
