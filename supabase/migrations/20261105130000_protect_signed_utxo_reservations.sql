-- Protect BTC/LTC UTXO reservations whenever a signed or potentially broadcast
-- transaction exists. Expiry is not evidence that a signed transaction was not sent.
BEGIN;

CREATE OR REPLACE FUNCTION public.prevent_signed_utxo_sweep_failure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_catalog.upper(coalesce(OLD.network, '')) IN ('BTC', 'LTC')
     AND NEW.status = 'FAILED'
     AND (
       OLD.signed_tx_hex IS NOT NULL
       OR OLD.sweep_tx_hash IS NOT NULL
     ) THEN
    RAISE EXCEPTION
      'BTC/LTC sweep with persisted signed transaction identity cannot be marked FAILED automatically; reconcile the exact transaction first'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_signed_utxo_sweep_failure
  ON public.sweep_operations;

CREATE TRIGGER trg_prevent_signed_utxo_sweep_failure
BEFORE UPDATE OF status ON public.sweep_operations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_signed_utxo_sweep_failure();


CREATE OR REPLACE FUNCTION public.protect_signed_utxo_reservation_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_status TEXT;
  v_signed_tx_hex TEXT;
  v_sweep_tx_hash TEXT;
  v_is_protected BOOLEAN := FALSE;
BEGIN
  SELECT
    s.status,
    s.signed_tx_hex,
    s.sweep_tx_hash
  INTO
    v_parent_status,
    v_signed_tx_hex,
    v_sweep_tx_hash
  FROM public.sweep_operations AS s
  WHERE s.id = OLD.sweep_id;

  IF NOT FOUND THEN
    -- Preserve fail-closed behavior for orphan reservations.
    RAISE EXCEPTION
      'Cannot modify or delete UTXO reservation without its parent sweep'
      USING ERRCODE = '23503';
  END IF;

  v_is_protected :=
    v_signed_tx_hex IS NOT NULL
    OR v_sweep_tx_hash IS NOT NULL
    OR pg_catalog.upper(coalesce(v_parent_status, '')) IN (
      'READY_TO_BROADCAST',
      'BROADCASTED',
      'RECOVERY_REQUIRED',
      'CONFIRMED'
    );

  IF NOT v_is_protected THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'UTXO reservation cannot be deleted while its signed sweep transaction is unresolved or confirmed'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.sweep_id IS DISTINCT FROM OLD.sweep_id
     OR NEW.txid IS DISTINCT FROM OLD.txid
     OR NEW.vout IS DISTINCT FROM OLD.vout
     OR NEW.network IS DISTINCT FROM OLD.network
     OR NEW.status = 'RELEASED'
     OR (NEW.reserved_until < OLD.reserved_until AND NEW.status NOT IN ('CONFIRMED', 'RECOVERY_REQUIRED')) THEN
    RAISE EXCEPTION
      'Signed or potentially broadcast UTXO reservation cannot be released, reassigned, or shortened'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'CONFIRMED' AND NEW.status <> 'CONFIRMED' THEN
    RAISE EXCEPTION
      'Confirmed UTXO reservation cannot move back to a non-confirmed state'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'RECOVERY_REQUIRED'
     AND NEW.status NOT IN ('RECOVERY_REQUIRED', 'CONFIRMED') THEN
    RAISE EXCEPTION
      'Recovery-held UTXO reservation cannot be reset or released automatically'
      USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'BROADCASTED'
     AND NEW.status NOT IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED') THEN
    RAISE EXCEPTION
      'Broadcast UTXO reservation cannot move back to a pre-broadcast state'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_signed_utxo_reservation_lifecycle
  ON public.utxo_reservations;

CREATE TRIGGER trg_protect_signed_utxo_reservation_lifecycle
BEFORE UPDATE OR DELETE ON public.utxo_reservations
FOR EACH ROW
EXECUTE FUNCTION public.protect_signed_utxo_reservation_lifecycle();

REVOKE ALL ON FUNCTION public.prevent_signed_utxo_sweep_failure()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.protect_signed_utxo_reservation_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.prevent_signed_utxo_sweep_failure() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_signed_utxo_reservation_lifecycle() TO postgres;

COMMIT;
