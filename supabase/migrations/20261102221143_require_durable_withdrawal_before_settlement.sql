-- Require the durable signed payload for settlement or a confirmed-revert refund.
BEGIN;

DO $migration$
DECLARE
  v_definition text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
    'public.complete_onchain_withdrawal(uuid,text,numeric,text)'::regprocedure
  ) INTO v_definition;

  v_old := $old$
  IF lower(coalesce(v_w.tx_hash, '')) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Withdrawal does not contain the exact recorded broadcast hash';
  END IF;
$old$;

  v_new := $new$
  IF lower(coalesce(v_w.tx_hash, '')) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Withdrawal does not contain the exact recorded broadcast hash';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.onchain_withdrawal_broadcasts b
    WHERE b.withdrawal_id = p_withdrawal_id
      AND lower(b.tx_hash) = v_hash
      AND upper(b.network) = upper(v_w.network)
      AND nullif(btrim(coalesce(b.signed_tx, '')), '') IS NOT NULL
      AND b.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
  ) THEN
    RAISE EXCEPTION 'Withdrawal has no matching durable signed payload; settlement is held for reconciliation';
  END IF;
$new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0
     OR ((length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))) / length(v_old)) <> 1 THEN
    RAISE EXCEPTION 'Could not locate a unique exact completion hash guard; aborting migration';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;

  SELECT pg_catalog.pg_get_functiondef(
    'public.process_failed_withdrawal(uuid,text,numeric,text,boolean)'::regprocedure
  ) INTO v_definition;

  v_old := $old$
    IF NOT coalesce(p_is_verified_unbroadcast, false)
       OR coalesce(p_actual_gas_amount, 0) <= 0
       OR v_status NOT IN ('ready_to_broadcast', 'broadcasted', 'processing', 'ambiguous_broadcast') THEN
      RAISE EXCEPTION 'Recorded broadcast cannot be refunded without confirmed revert and measured gas';
    END IF;
$old$;

  v_new := $new$
    IF NOT coalesce(p_is_verified_unbroadcast, false)
       OR coalesce(p_actual_gas_amount, 0) <= 0
       OR v_status NOT IN ('ready_to_broadcast', 'broadcasted', 'processing', 'ambiguous_broadcast') THEN
      RAISE EXCEPTION 'Recorded broadcast cannot be refunded without confirmed revert and measured gas';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_broadcasts b
      WHERE b.withdrawal_id = p_withdrawal_id
        AND lower(b.tx_hash) = v_hash
        AND upper(b.network) = upper(v_w.network)
        AND nullif(btrim(coalesce(b.signed_tx, '')), '') IS NOT NULL
        AND b.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED')
    ) THEN
      RAISE EXCEPTION 'Withdrawal has no matching durable signed payload; revert refund is held for manual reconciliation';
    END IF;
$new$;

  IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Could not locate exact confirmed-revert guard; aborting migration';
  END IF;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$migration$;

COMMIT;