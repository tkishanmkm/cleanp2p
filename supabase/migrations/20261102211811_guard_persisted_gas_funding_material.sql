-- Prevent stale or partial gas-funding signatures from being overwritten or re-signed.
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_gas_funding_signed_material()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_has_signed boolean;
  v_has_hash boolean;
  v_old_has_signed boolean := false;
  v_old_has_hash boolean := false;
BEGIN
  v_has_signed := nullif(btrim(coalesce(NEW.signed_tx_hex, '')), '') IS NOT NULL;
  v_has_hash := nullif(btrim(coalesce(NEW.tx_hash, '')), '') IS NOT NULL;

  IF TG_OP = 'UPDATE' THEN
    v_old_has_signed := nullif(btrim(coalesce(OLD.signed_tx_hex, '')), '') IS NOT NULL;
    v_old_has_hash := nullif(btrim(coalesce(OLD.tx_hash, '')), '') IS NOT NULL;

    IF v_old_has_signed AND NEW.signed_tx_hex IS DISTINCT FROM OLD.signed_tx_hex THEN
      RAISE EXCEPTION 'Persisted gas-funding signed bytes are immutable'
        USING ERRCODE = '23505';
    END IF;
    IF v_old_has_hash AND lower(btrim(NEW.tx_hash)) IS DISTINCT FROM lower(btrim(OLD.tx_hash)) THEN
      RAISE EXCEPTION 'Persisted gas-funding transaction hash is immutable'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF v_has_signed IS DISTINCT FROM v_has_hash THEN
    RAISE EXCEPTION 'Gas-funding signed bytes and transaction hash must be stored together'
      USING ERRCODE = '23514';
  END IF;

  IF upper(coalesce(NEW.status, '')) = 'PENDING' AND (v_has_signed OR v_has_hash) THEN
    RAISE EXCEPTION 'PENDING gas-funding operations cannot contain signed transaction material'
      USING ERRCODE = '23514';
  END IF;

  IF upper(coalesce(NEW.status, '')) IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED')
     AND NOT (v_has_signed AND v_has_hash) THEN
    RAISE EXCEPTION 'Signed gas-funding states require immutable signed bytes and a transaction hash'
      USING ERRCODE = '23514';
  END IF;

  IF upper(coalesce(NEW.status, '')) = 'FAILED'
     AND (v_old_has_signed OR v_old_has_hash OR v_has_signed OR v_has_hash) THEN
    RAISE EXCEPTION 'A signed or ambiguous gas-funding transaction cannot be marked FAILED'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_gas_funding_signed_material
  ON public.gas_funding_operations;

CREATE TRIGGER trg_guard_gas_funding_signed_material
BEFORE INSERT OR UPDATE ON public.gas_funding_operations
FOR EACH ROW
EXECUTE FUNCTION public.guard_gas_funding_signed_material();

CREATE UNIQUE INDEX IF NOT EXISTS uq_gas_funding_operation_tx_hash
  ON public.gas_funding_operations (lower(tx_hash), upper(network))
  WHERE nullif(btrim(coalesce(tx_hash, '')), '') IS NOT NULL;

COMMIT;