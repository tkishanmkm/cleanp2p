-- Bind each BTC/LTC reserved outpoint to its independently verified previous-output value.
-- The worker supplies values only after raw previous-transaction verification.
-- The signed-intent persistence trigger requires exact equality with the reservation ledger.

BEGIN;

ALTER TABLE public.utxo_reservations
  ADD COLUMN IF NOT EXISTS value_sat BIGINT;

ALTER TABLE public.utxo_reservations
  DROP CONSTRAINT IF EXISTS utxo_reservations_value_sat_positive;
ALTER TABLE public.utxo_reservations
  ADD CONSTRAINT utxo_reservations_value_sat_positive
  CHECK (value_sat IS NULL OR value_sat > 0);

CREATE OR REPLACE FUNCTION public.reserve_utxos_for_sweep(
  p_sweep_id UUID,
  p_worker_id TEXT,
  p_network TEXT,
  p_utxos JSONB,
  p_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network TEXT := pg_catalog.upper(pg_catalog.btrim(coalesce(p_network, '')));
  v_item JSONB;
  v_txid TEXT;
  v_vout INTEGER;
  v_value BIGINT;
  v_count INTEGER;
  v_unique_count INTEGER;
  v_conflicts INTEGER;
  v_until TIMESTAMPTZ;
  v_rows INTEGER;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to reserve custodial UTXOs' USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL OR p_worker_id IS NULL
     OR pg_catalog.btrim(p_worker_id) = '' OR pg_catalog.length(p_worker_id) > 128
     OR v_network NOT IN ('BTC', 'LTC')
     OR p_utxos IS NULL OR pg_catalog.jsonb_typeof(p_utxos) IS DISTINCT FROM 'array'
     OR p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid custodial UTXO reservation payload' USING ERRCODE = '22023';
  END IF;

  v_count := pg_catalog.jsonb_array_length(p_utxos);
  IF v_count < 1 OR v_count > 100 THEN
    RAISE EXCEPTION 'UTXO reservation must contain between 1 and 100 inputs' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'UTXO reservation requires the active sweep worker lease' USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.upper(pg_catalog.btrim(coalesce(v_sweep.network, ''))) IS DISTINCT FROM v_network
     OR pg_catalog.upper(coalesce(v_sweep.status, '')) <> 'CLAIMED' THEN
    RAISE EXCEPTION 'UTXO reservation network or sweep status does not match the active claim' USING ERRCODE = '55000';
  END IF;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_utxos)
  LOOP
    IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'UTXO reservation entry must be an object' USING ERRCODE = '22023';
    END IF;
    v_txid := pg_catalog.lower(pg_catalog.btrim(coalesce(v_item->>'txid', '')));
    IF v_txid !~ '^[0-9a-f]{64}$'
       OR coalesce(v_item->>'vout', '') !~ '^(0|[1-9][0-9]{0,9})$'
       OR coalesce(v_item->>'value_sat', '') !~ '^[1-9][0-9]{0,15}$' THEN
      RAISE EXCEPTION 'UTXO reservation requires a valid outpoint and positive value_sat' USING ERRCODE = '22023';
    END IF;
    v_vout := (v_item->>'vout')::INTEGER;
    v_value := (v_item->>'value_sat')::BIGINT;
    IF v_vout < 0 OR v_value > 8400000000000000 THEN
      RAISE EXCEPTION 'UTXO outpoint or value is outside supported range' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT pg_catalog.count(DISTINCT
    pg_catalog.lower(value->>'txid') || ':' || (value->>'vout')
  ) INTO v_unique_count
  FROM pg_catalog.jsonb_array_elements(p_utxos);
  IF v_unique_count <> v_count THEN
    RAISE EXCEPTION 'UTXO reservation payload contains duplicate outpoints' USING ERRCODE = '22023';
  END IF;

  -- Expired rows are reclaimed only if their parent has no signed identity and no live lease.
  DELETE FROM public.utxo_reservations r
  WHERE r.status = 'RESERVED'
    AND r.reserved_until <= pg_catalog.clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public.sweep_operations s
      WHERE s.id = r.sweep_id
        AND (
          nullif(pg_catalog.btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
          OR nullif(pg_catalog.btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL
          OR s.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
          OR s.lease_expires_at > pg_catalog.clock_timestamp()
        )
    );

  SELECT pg_catalog.count(*) INTO v_conflicts
  FROM pg_catalog.jsonb_array_elements(p_utxos) item
  JOIN public.utxo_reservations r
    ON r.txid = pg_catalog.lower(item.value->>'txid')
   AND r.vout = (item.value->>'vout')::INTEGER
   AND r.network = v_network
  WHERE r.sweep_id <> p_sweep_id
    AND r.status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED');

  IF v_conflicts > 0 THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'UTXO_CONFLICT');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.utxo_reservations r
    JOIN pg_catalog.jsonb_array_elements(p_utxos) item
      ON r.txid = pg_catalog.lower(item.value->>'txid')
     AND r.vout = (item.value->>'vout')::INTEGER
     AND r.network = v_network
    WHERE r.sweep_id = p_sweep_id
      AND r.status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED')
  ) THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'UTXO_ALREADY_SIGNED');
  END IF;

  v_until := pg_catalog.clock_timestamp() + (p_lease_seconds * INTERVAL '1 second');
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_utxos)
  LOOP
    v_txid := pg_catalog.lower(pg_catalog.btrim(v_item->>'txid'));
    v_vout := (v_item->>'vout')::INTEGER;
    v_value := (v_item->>'value_sat')::BIGINT;

    INSERT INTO public.utxo_reservations (
      txid, vout, network, sweep_id, status, reserved_until, value_sat
    ) VALUES (
      v_txid, v_vout, v_network, p_sweep_id, 'RESERVED', v_until, v_value
    )
    ON CONFLICT (txid, vout, network)
    DO UPDATE SET
      sweep_id = EXCLUDED.sweep_id,
      status = 'RESERVED',
      reserved_until = EXCLUDED.reserved_until,
      value_sat = EXCLUDED.value_sat
    WHERE public.utxo_reservations.sweep_id = p_sweep_id
      AND public.utxo_reservations.status IN ('RESERVED', 'RELEASED');

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'UTXO reservation conflict detected for outpoint %:%', v_txid, v_vout
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('success', true, 'count', v_count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.require_signed_utxo_values_match_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_inputs JSONB;
  v_expected_count INTEGER;
  v_matched_count INTEGER;
BEGIN
  IF pg_catalog.upper(coalesce(NEW.network, '')) NOT IN ('BTC', 'LTC')
     OR (NEW.signed_tx_hex IS NULL AND NEW.sweep_tx_hash IS NULL) THEN
    RETURN NEW;
  END IF;

  v_inputs := NEW.signed_utxo_intent->'inputs';
  IF pg_catalog.jsonb_typeof(v_inputs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Signed UTXO transaction requires an immutable input intent' USING ERRCODE = '23514';
  END IF;

  v_expected_count := pg_catalog.jsonb_array_length(v_inputs);
  IF v_expected_count < 1 OR v_expected_count > 100 THEN
    RAISE EXCEPTION 'Signed UTXO intent input count is invalid' USING ERRCODE = '23514';
  END IF;

  SELECT pg_catalog.count(*)::INTEGER INTO v_matched_count
  FROM public.utxo_reservations r
  JOIN LATERAL pg_catalog.jsonb_array_elements(v_inputs) i(value)
    ON r.txid = pg_catalog.lower(i.value->>'txid')
   AND r.vout = (i.value->>'vout')::INTEGER
   AND r.value_sat = (i.value->>'value_sat')::BIGINT
  WHERE r.sweep_id = NEW.id
    AND pg_catalog.upper(r.network) = pg_catalog.upper(NEW.network)
    AND r.status = 'RESERVED'
    AND r.reserved_until > pg_catalog.clock_timestamp()
    AND i.value->>'value_sat' ~ '^[1-9][0-9]{0,15}$';

  IF v_matched_count <> v_expected_count
     OR (
       SELECT pg_catalog.count(*)
       FROM public.utxo_reservations r
       WHERE r.sweep_id = NEW.id
         AND pg_catalog.upper(r.network) = pg_catalog.upper(NEW.network)
         AND r.status = 'RESERVED'
         AND r.reserved_until > pg_catalog.clock_timestamp()
     ) <> v_expected_count THEN
    RAISE EXCEPTION 'Signed UTXO intent values must exactly match active reserved outpoints and values'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_require_signed_utxo_values_match_reservations
  ON public.sweep_operations;
CREATE TRIGGER trg_require_signed_utxo_values_match_reservations
  BEFORE UPDATE OF signed_tx_hex, sweep_tx_hash, signed_utxo_intent
  ON public.sweep_operations
  FOR EACH ROW
  EXECUTE FUNCTION public.require_signed_utxo_values_match_reservations();

REVOKE ALL ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, TEXT, JSONB, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_utxos_for_sweep(UUID, TEXT, TEXT, JSONB, INTEGER)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.require_signed_utxo_values_match_reservations()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.require_signed_utxo_values_match_reservations()
  TO postgres;

COMMIT;
