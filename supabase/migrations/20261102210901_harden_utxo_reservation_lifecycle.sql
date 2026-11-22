-- Persist UTXO locks with signed sweeps and require active worker ownership.
BEGIN;

ALTER TABLE public.utxo_reservations
  DROP CONSTRAINT IF EXISTS utxo_reservations_status_check;

ALTER TABLE public.utxo_reservations
  ADD CONSTRAINT utxo_reservations_status_check
  CHECK (status = ANY (ARRAY[
    'RESERVED'::text,
    'SIGNED'::text,
    'BROADCASTED'::text,
    'CONFIRMED'::text,
    'RELEASED'::text,
    'RECOVERY_REQUIRED'::text
  ]));

CREATE OR REPLACE FUNCTION public.sync_utxo_reservation_status_from_sweep()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'READY_TO_BROADCAST'
     AND nullif(btrim(coalesce(NEW.signed_tx_hex, '')), '') IS NOT NULL
     AND nullif(btrim(coalesce(NEW.sweep_tx_hash, '')), '') IS NOT NULL THEN
    UPDATE public.utxo_reservations
    SET status = 'SIGNED',
        reserved_until = 'infinity'::timestamptz
    WHERE sweep_id = NEW.id
      AND status IN ('RESERVED', 'SIGNED');
  ELSIF NEW.status = 'BROADCASTED' THEN
    UPDATE public.utxo_reservations
    SET status = 'BROADCASTED',
        reserved_until = 'infinity'::timestamptz
    WHERE sweep_id = NEW.id
      AND status IN ('RESERVED', 'SIGNED', 'BROADCASTED');
  ELSIF NEW.status = 'RECOVERY_REQUIRED' THEN
    UPDATE public.utxo_reservations
    SET status = 'RECOVERY_REQUIRED',
        reserved_until = 'infinity'::timestamptz
    WHERE sweep_id = NEW.id
      AND status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
  ELSIF NEW.status = 'CONFIRMED' THEN
    UPDATE public.utxo_reservations
    SET status = 'CONFIRMED',
        reserved_until = 'infinity'::timestamptz
    WHERE sweep_id = NEW.id
      AND status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED');
  ELSIF NEW.status = 'FAILED'
     AND nullif(btrim(coalesce(OLD.signed_tx_hex, '')), '') IS NULL
     AND nullif(btrim(coalesce(OLD.sweep_tx_hash, '')), '') IS NULL THEN
    UPDATE public.utxo_reservations
    SET status = 'RELEASED',
        reserved_until = pg_catalog.clock_timestamp()
    WHERE sweep_id = NEW.id
      AND status = 'RESERVED';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_utxo_reservation_status_from_sweep
  ON public.sweep_operations;

CREATE TRIGGER trg_sync_utxo_reservation_status_from_sweep
AFTER UPDATE OF status ON public.sweep_operations
FOR EACH ROW
EXECUTE FUNCTION public.sync_utxo_reservation_status_from_sweep();

-- Backfill durable locks for signed/broadcast/recovery/confirmed sweeps that
-- predate this migration. Never expire a UTXO whose transaction is persisted.
UPDATE public.utxo_reservations r
SET status = CASE s.status
      WHEN 'READY_TO_BROADCAST' THEN 'SIGNED'
      WHEN 'BROADCASTED' THEN 'BROADCASTED'
      WHEN 'RECOVERY_REQUIRED' THEN 'RECOVERY_REQUIRED'
      WHEN 'CONFIRMED' THEN 'CONFIRMED'
      ELSE r.status
    END,
    reserved_until = 'infinity'::timestamptz
FROM public.sweep_operations s
WHERE s.id = r.sweep_id
  AND r.status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
  AND (
    (s.status = 'READY_TO_BROADCAST'
      AND nullif(btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
      AND nullif(btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL)
    OR s.status IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
  );

CREATE OR REPLACE FUNCTION public.reserve_utxos_for_sweep(
  p_sweep_id uuid,
  p_worker_id text,
  p_network text,
  p_utxos jsonb,
  p_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_item jsonb;
  v_txid text;
  v_vout integer;
  v_count integer;
  v_unique_count integer;
  v_conflicts integer;
  v_until timestamptz;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to reserve custodial UTXOs'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR v_network NOT IN ('BTC', 'LTC')
     OR p_utxos IS NULL
     OR pg_catalog.jsonb_typeof(p_utxos) IS DISTINCT FROM 'array'
     OR p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid custodial UTXO reservation payload'
      USING ERRCODE = '22023';
  END IF;

  v_count := pg_catalog.jsonb_array_length(p_utxos);
  IF v_count < 1 OR v_count > 100 THEN
    RAISE EXCEPTION 'Custodial UTXO reservation must contain between 1 and 100 inputs'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'UTXO reservation requires the active sweep worker lease'
      USING ERRCODE = '42501';
  END IF;

  IF upper(btrim(coalesce(v_sweep.network, ''))) IS DISTINCT FROM v_network
     OR upper(coalesce(v_sweep.status, '')) <> 'CLAIMED' THEN
    RAISE EXCEPTION 'UTXO reservation network or sweep status does not match the active claim'
      USING ERRCODE = '55000';
  END IF;

  -- Validate each outpoint before taking any locks.
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_utxos)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'UTXO reservation entry must be an object'
        USING ERRCODE = '22023';
    END IF;

    v_txid := lower(btrim(coalesce(v_item->>'txid', '')));
    IF v_txid !~ '^[0-9a-f]{64}$'
       OR coalesce(v_item->>'vout', '') !~ '^(0|[1-9][0-9]{0,9})$' THEN
      RAISE EXCEPTION 'UTXO reservation contains an invalid txid or vout'
        USING ERRCODE = '22023';
    END IF;
    v_vout := (v_item->>'vout')::integer;
    IF v_vout < 0 THEN
      RAISE EXCEPTION 'UTXO vout must be non-negative'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT count(DISTINCT lower(value->>'txid') || ':' || (value->>'vout'))
    INTO v_unique_count
  FROM pg_catalog.jsonb_array_elements(p_utxos);
  IF v_unique_count <> v_count THEN
    RAISE EXCEPTION 'UTXO reservation payload contains duplicate outpoints'
      USING ERRCODE = '22023';
  END IF;

  -- Only abandon an expired RESERVED row when its parent sweep has no signed
  -- transaction and no live worker lease. Durable rows are never auto-deleted.
  DELETE FROM public.utxo_reservations r
  WHERE r.status = 'RESERVED'
    AND r.reserved_until <= pg_catalog.clock_timestamp()
    AND NOT EXISTS (
      SELECT 1
      FROM public.sweep_operations s
      WHERE s.id = r.sweep_id
        AND (
          nullif(btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
          OR nullif(btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL
          OR s.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
          OR s.lease_expires_at > pg_catalog.clock_timestamp()
        )
    );

  SELECT count(*)
    INTO v_conflicts
  FROM pg_catalog.jsonb_array_elements(p_utxos) item
  JOIN public.utxo_reservations r
    ON r.txid = lower(item.value->>'txid')
   AND r.vout = (item.value->>'vout')::integer
   AND r.network = v_network
  WHERE r.sweep_id <> p_sweep_id
    AND r.status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED');

  IF v_conflicts > 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'UTXO_CONFLICT',
      'message', 'One or more UTXOs are locked by another active or durable sweep'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.utxo_reservations r
    JOIN pg_catalog.jsonb_array_elements(p_utxos) item
      ON r.txid = lower(item.value->>'txid')
     AND r.vout = (item.value->>'vout')::integer
     AND r.network = v_network
    WHERE r.sweep_id = p_sweep_id
      AND r.status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', false,
      'code', 'UTXO_ALREADY_SIGNED',
      'message', 'This sweep already has a durable UTXO lock and must be reconciled, not reserved again'
    );
  END IF;

  v_until := pg_catalog.clock_timestamp() + (p_lease_seconds * interval '1 second');

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_utxos)
  LOOP
    v_txid := lower(btrim(v_item->>'txid'));
    v_vout := (v_item->>'vout')::integer;

    INSERT INTO public.utxo_reservations (
      txid, vout, network, sweep_id, status, reserved_until
    )
    VALUES (
      v_txid, v_vout, v_network, p_sweep_id, 'RESERVED', v_until
    )
    ON CONFLICT (txid, vout, network)
    DO UPDATE SET
      sweep_id = EXCLUDED.sweep_id,
      status = 'RESERVED',
      reserved_until = EXCLUDED.reserved_until
    WHERE public.utxo_reservations.sweep_id = p_sweep_id
      AND public.utxo_reservations.status IN ('RESERVED', 'RELEASED');

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'UTXO reservation conflict detected while acquiring outpoint %:%', v_txid, v_vout
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('success', true, 'count', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_signed_btc_ltc_transaction(
  p_sweep_id uuid,
  p_worker_id text,
  p_expected_status text,
  p_signed_tx_hex text,
  p_sweep_tx_hash text,
  p_extend_lease_seconds integer DEFAULT 300
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network text;
  v_hash text := lower(btrim(coalesce(p_sweep_tx_hash, '')));
  v_reserved_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist signed BTC/LTC sweep transactions'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_expected_status IS DISTINCT FROM 'CLAIMED'
     OR p_signed_tx_hex IS NULL
     OR length(btrim(p_signed_tx_hex)) < 20
     OR length(p_signed_tx_hex) > 1000000
     OR length(btrim(p_signed_tx_hex)) % 2 <> 0
     OR btrim(p_signed_tx_hex) !~ '^[0-9a-fA-F]+$'
     OR v_hash !~ '^[0-9a-f]{64}$'
     OR p_extend_lease_seconds IS NULL
     OR p_extend_lease_seconds < 30
     OR p_extend_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid signed BTC/LTC sweep transaction payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(coalesce(v_sweep.status, '')) <> 'CLAIMED' THEN
    RAISE EXCEPTION 'Worker does not own an active CLAIMED BTC/LTC sweep lease'
      USING ERRCODE = '42501';
  END IF;

  v_network := upper(btrim(coalesce(v_sweep.network, '')));
  IF v_network NOT IN ('BTC', 'LTC') THEN
    RAISE EXCEPTION 'Only BTC and LTC sweeps can persist through this procedure'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NOT NULL
     OR nullif(btrim(coalesce(v_sweep.sweep_tx_hash, '')), '') IS NOT NULL THEN
    IF lower(coalesce(v_sweep.sweep_tx_hash, '')) = v_hash
       AND v_sweep.signed_tx_hex = btrim(p_signed_tx_hex)
       AND v_sweep.status = 'READY_TO_BROADCAST' THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'idempotent', true,
        'status', 'READY_TO_BROADCAST',
        'sweep_tx_hash', v_hash
      );
    END IF;
    RAISE EXCEPTION 'A different or prior signed transaction is already persisted; refusing replacement'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sweep_operations s
    WHERE lower(coalesce(s.sweep_tx_hash, '')) = v_hash
      AND s.id <> p_sweep_id
  ) THEN
    RAISE EXCEPTION 'Signed transaction hash is already assigned to another sweep'
      USING ERRCODE = '23505';
  END IF;

  SELECT count(*)
    INTO v_reserved_count
  FROM public.utxo_reservations r
  WHERE r.sweep_id = p_sweep_id
    AND r.network = v_network
    AND r.status = 'RESERVED'
    AND r.reserved_until > pg_catalog.clock_timestamp();

  IF v_reserved_count < 1 THEN
    RAISE EXCEPTION 'Signed BTC/LTC sweep requires one or more live UTXO reservations'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.sweep_operations
  SET status = 'READY_TO_BROADCAST',
      signed_tx_hex = btrim(p_signed_tx_hex),
      sweep_tx_hash = v_hash,
      lease_expires_at = pg_catalog.clock_timestamp() + (p_extend_lease_seconds * interval '1 second'),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_sweep_id
    AND worker_id = p_worker_id
    AND status = 'CLAIMED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed BTC/LTC transaction could not be durably persisted';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'idempotent', false,
    'sweep_id', p_sweep_id,
    'status', 'READY_TO_BROADCAST',
    'sweep_tx_hash', v_hash,
    'reserved_utxo_count', v_reserved_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_utxos_for_sweep(uuid,text,jsonb,integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_utxos_for_sweep(uuid,text,text,jsonb,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_signed_btc_ltc_transaction(uuid,text,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(uuid,text,text,jsonb,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_signed_btc_ltc_transaction(uuid,text,text,text,text,integer)
  TO service_role;

COMMIT;