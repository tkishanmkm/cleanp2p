BEGIN;

-- Candidate repair for the production request_withdrawal insert-contract defect.
-- This migration is intentionally fail-closed: it only patches the exact known
-- function shape and requires the existing NOT NULL idempotency column.
DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure('public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)');
  v_definition text;
  v_normalized text;
  v_patched text;
  v_column_count integer;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Expected request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) is missing.';
  END IF;

  SELECT count(*) INTO v_column_count
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'onchain_withdrawals'
    AND a.attname = 'idempotency_key'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attnotnull;

  IF v_column_count <> 1 THEN
    RAISE EXCEPTION 'Expected public.onchain_withdrawals.idempotency_key NOT NULL column; found % matching columns.', v_column_count;
  END IF;

  v_definition := pg_get_functiondef(v_signature);
  v_normalized := replace(v_definition, chr(13), '');

  IF position('INSERT INTO public.onchain_withdrawals (' in v_normalized) = 0
     OR position('        status,' || chr(10) || '        metadata,' || chr(10) || '        created_at,' || chr(10) || '        updated_at' in v_normalized) = 0
     OR position('        v_onchain_status,' || chr(10) || '        jsonb_build_object(' in v_normalized) = 0 THEN
    RAISE EXCEPTION 'request_withdrawal insert shape differs from the audited production definition; manual reconciliation required.';
  END IF;

  v_patched := replace(
    v_normalized,
    '        status,' || chr(10) || '        metadata,' || chr(10) || '        created_at,' || chr(10) || '        updated_at',
    '        status,' || chr(10) || '        idempotency_key,' || chr(10) || '        metadata,' || chr(10) || '        created_at,' || chr(10) || '        updated_at'
  );

  v_patched := replace(
    v_patched,
    '        v_onchain_status,' || chr(10) || '        jsonb_build_object(',
    '        v_onchain_status,' || chr(10) || '        ''w_'' || v_withdrawal_id::TEXT,' || chr(10) || '        jsonb_build_object('
  );

  IF v_patched = v_normalized
     OR position('        idempotency_key,' || chr(10) || '        metadata,' in v_patched) = 0
     OR position('        ''w_'' || v_withdrawal_id::TEXT,' || chr(10) || '        jsonb_build_object(' in v_patched) = 0 THEN
    RAISE EXCEPTION 'Idempotency-key patch did not apply completely; refusing partial migration.';
  END IF;

  -- Ensure only the intended onchain insert is changed and preserve function
  -- privileges/other body logic by replacing the existing definition in place.
  EXECUTE v_patched;
END;
$migration$;

COMMIT;
