-- Once a positive swept amount has been persisted, it is immutable.
-- TRON stores the exact amount with its signed payload before broadcast; UTXO/EVM
-- flows may set the amount at final reconciliation. Repeated identical writes
-- remain valid for idempotent state transitions.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_sweep_amount_swept_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF OLD.amount_swept IS NOT NULL
     AND OLD.amount_swept > 0
     AND NEW.amount_swept IS DISTINCT FROM OLD.amount_swept THEN
    RAISE EXCEPTION 'Persisted sweep amount is immutable once positive'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_sweep_amount_swept_immutability()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_sweep_amount_swept_immutability
  ON public.sweep_operations;

CREATE TRIGGER trg_guard_sweep_amount_swept_immutability
  BEFORE UPDATE OF amount_swept ON public.sweep_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sweep_amount_swept_immutability();

COMMENT ON FUNCTION public.guard_sweep_amount_swept_immutability()
  IS 'Prevents mutation of a positive sweep amount after it has been durably recorded; identical idempotent writes remain allowed.';

COMMIT;
