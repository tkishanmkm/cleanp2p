-- Fail closed if a previously terminal legacy deposit is sent back through pending registration.
-- Patches only the exact audited legacy process_deposit_atomic function body.
-- No balances, ledger rows, or existing deposit records are modified by this migration.
BEGIN;

DO $migration$
DECLARE
  v_signature regprocedure := to_regprocedure(
    'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
  );
  v_definition text;
  v_marker text := '    -- PENDING DEPOSIT';
  v_ledger_marker text := '    IF v_ledger_count > 1 THEN';
  v_guard text := $guard$
    -- Do not downgrade a terminal deposit to PENDING. The legacy RPC's pending
    -- branch otherwise rewrites deposits.status before its ledger idempotency
    -- check, which can reopen a previously credited output for a second credit.
    IF NOT v_is_confirmed AND (
      (v_existing_deposit.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_deposit.status, ''))) IN ('CONFIRMED', 'CREDITED'))
      OR (v_existing_onchain.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED'))
      OR (v_existing_deposit.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.ledger_entries le
        WHERE le.reference_id = v_existing_deposit.id::TEXT
      ))
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'credited', false,
        'code', 'DEPOSIT_STATE_INCONSISTENT',
        'message', 'Deposit output has terminal state or an existing ledger entry and cannot be re-registered as pending; reconcile before retrying'
      );
    END IF;

$guard$;
  v_ledger_guard text := $ledger_guard$
    -- Existing terminal tracking rows with no ledger entry must not be credited again.
    IF v_ledger_count = 0 AND (
      (v_existing_deposit.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_deposit.status, ''))) IN ('CONFIRMED', 'CREDITED'))
      OR
      (v_existing_onchain.id IS NOT NULL
        AND upper(btrim(coalesce(v_existing_onchain.status, ''))) IN ('CONFIRMED', 'CREDITED'))
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'credited', false,
        'code', 'DEPOSIT_STATE_INCONSISTENT',
        'message', 'Terminal deposit output has no matching ledger entry; manual reconciliation required'
      );
    END IF;

$ledger_guard$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'Preflight failed: expected legacy process_deposit_atomic signature is missing';
  END IF;

  v_definition := pg_get_functiondef(v_signature);

  IF length(v_definition) - length(replace(v_definition, v_marker, '')) <> length(v_marker)
     OR length(v_definition) - length(replace(v_definition, v_ledger_marker, '')) <> length(v_ledger_marker) THEN
    RAISE EXCEPTION 'Preflight failed: expected exactly one pending and ledger marker';
  END IF;
  IF position('v_ledger_count = 1' IN v_definition) = 0
     OR position('reference_id = v_deposit_id::TEXT' IN v_definition) = 0
     OR position('status = ''PENDING''' IN v_definition) = 0
     OR position('INTO v_existing_deposit' IN v_definition) = 0
     OR position('INTO v_existing_onchain' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Preflight failed: legacy function body differs from the reviewed version';
  END IF;
  IF position('Deposit output has terminal state or an existing ledger entry' IN v_definition) = 0 THEN
    v_definition := replace(v_definition, v_marker, v_guard || v_marker);
  END IF;
  IF position('Terminal deposit output has no matching ledger entry' IN v_definition) = 0 THEN
    v_definition := replace(v_definition, v_ledger_marker, v_ledger_guard || v_ledger_marker);
  END IF;
  EXECUTE v_definition;
END
$migration$;

COMMIT;
