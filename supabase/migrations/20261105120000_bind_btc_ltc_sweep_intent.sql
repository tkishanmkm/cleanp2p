-- Persist immutable UTXO sweep intent with signed BTC/LTC bytes.
BEGIN;
ALTER TABLE public.sweep_operations ADD COLUMN IF NOT EXISTS signed_utxo_intent JSONB;

CREATE OR REPLACE FUNCTION public.prevent_signed_sweep_intent_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (OLD.signed_tx_hex IS NOT NULL OR OLD.sweep_tx_hash IS NOT NULL) AND (
    NEW.signed_tx_hex IS DISTINCT FROM OLD.signed_tx_hex
    OR NEW.sweep_tx_hash IS DISTINCT FROM OLD.sweep_tx_hash
    OR NEW.signed_asset_code IS DISTINCT FROM OLD.signed_asset_code
    OR NEW.signed_token_contract IS DISTINCT FROM OLD.signed_token_contract
    OR NEW.signed_recipient IS DISTINCT FROM OLD.signed_recipient
    OR NEW.signed_amount_raw IS DISTINCT FROM OLD.signed_amount_raw
    OR NEW.signed_chain_id IS DISTINCT FROM OLD.signed_chain_id
    OR NEW.signed_utxo_intent IS DISTINCT FROM OLD.signed_utxo_intent
  ) THEN
    RAISE EXCEPTION 'Persisted signed sweep payload and intent are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;

DROP FUNCTION IF EXISTS public.persist_signed_btc_ltc_transaction(UUID, TEXT, TEXT, TEXT, TEXT, INTEGER);
CREATE FUNCTION public.persist_signed_btc_ltc_transaction(
  p_sweep_id UUID, p_worker_id TEXT, p_expected_status TEXT,
  p_signed_tx_hex TEXT, p_sweep_tx_hash TEXT, p_signed_utxo_intent JSONB,
  p_extend_lease_seconds INTEGER DEFAULT 300
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network TEXT;
  v_input_total NUMERIC := 0;
  v_item JSONB;
  v_inputs JSONB;
  v_script TEXT;
  v_output NUMERIC;
  v_fee NUMERIC;
  v_lease TIMESTAMPTZ;
  v_input_count INTEGER := 0;
  v_reserved_count INTEGER := 0;
  v_matched_count INTEGER := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_sweep_id IS NULL OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
     OR pg_catalog.length(p_worker_id) > 128 OR p_expected_status IS DISTINCT FROM 'CLAIMED'
     OR p_signed_tx_hex IS NULL OR p_signed_tx_hex !~ '^([0-9a-fA-F]{2})+$'
     OR p_sweep_tx_hash IS NULL OR p_sweep_tx_hash !~* '^[0-9a-f]{64}$'
     OR p_signed_utxo_intent IS NULL OR pg_catalog.jsonb_typeof(p_signed_utxo_intent) <> 'object'
     OR p_extend_lease_seconds IS NULL OR p_extend_lease_seconds < 30 OR p_extend_lease_seconds > 900 THEN
    RAISE EXCEPTION 'Invalid signed UTXO sweep payload' USING ERRCODE = '22023';
  END IF;
  v_inputs := p_signed_utxo_intent->'inputs';
  v_script := p_signed_utxo_intent->>'destination_script_hex';
  v_output := (p_signed_utxo_intent->>'output_amount_sat')::NUMERIC;
  v_fee := (p_signed_utxo_intent->>'fee_amount_sat')::NUMERIC;
  IF pg_catalog.jsonb_typeof(v_inputs) <> 'array'
     OR pg_catalog.jsonb_array_length(v_inputs) < 1 OR pg_catalog.jsonb_array_length(v_inputs) > 100
     OR v_script IS NULL OR v_script !~ '^([0-9a-fA-F]{2})+$'
     OR v_output IS NULL OR v_output <= 0 OR v_output <> pg_catalog.trunc(v_output)
     OR v_fee IS NULL OR v_fee < 0 OR v_fee <> pg_catalog.trunc(v_fee) THEN
    RAISE EXCEPTION 'Invalid UTXO intent fields' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_inputs) LOOP
    IF v_item->>'txid' IS NULL OR v_item->>'txid' !~* '^[0-9a-f]{64}$'
       OR v_item->>'vout' IS NULL OR (v_item->>'vout') !~ '^[0-9]{1,10}$'
       OR (v_item->>'vout')::NUMERIC > 2147483647
       OR v_item->>'value_sat' IS NULL OR (v_item->>'value_sat') !~ '^[1-9][0-9]{0,15}$'
       OR (v_item->>'value_sat')::NUMERIC > 8400000000000000 THEN
      RAISE EXCEPTION 'Invalid or out-of-range UTXO input outpoint or value' USING ERRCODE = '22023';
    END IF;
    v_input_total := v_input_total + (v_item->>'value_sat')::NUMERIC;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(v_inputs) AS input_item(value)
    GROUP BY pg_catalog.lower(input_item.value->>'txid'), (input_item.value->>'vout')::NUMERIC
    HAVING pg_catalog.count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate UTXO outpoints are not allowed' USING ERRCODE = '22023';
  END IF;
  IF v_input_total <> v_output + v_fee THEN
    RAISE EXCEPTION 'UTXO inputs must equal output plus fee' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sweep FROM public.sweep_operations WHERE id = p_sweep_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SWEEP_NOT_FOUND'); END IF;
  IF v_sweep.worker_id IS DISTINCT FROM p_worker_id OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'ACTIVE_LEASE_REQUIRED');
  END IF;
  IF v_sweep.status IS DISTINCT FROM 'CLAIMED' THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'STATE_MISMATCH');
  END IF;
  v_network := pg_catalog.upper(pg_catalog.btrim(COALESCE(v_sweep.network, '')));
  IF v_network NOT IN ('BTC', 'LTC') THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK');
  END IF;

  -- Lock this sweep's reservation rows, then require an exact one-to-one match
  -- between every signed transaction input and an active reservation owned by it.
  PERFORM r.txid
  FROM public.utxo_reservations AS r
  WHERE r.sweep_id = p_sweep_id
    AND r.network = v_network
  FOR UPDATE;

  v_input_count := pg_catalog.jsonb_array_length(v_inputs);
  SELECT pg_catalog.count(*)::INTEGER
    INTO v_reserved_count
  FROM public.utxo_reservations AS r
  WHERE r.sweep_id = p_sweep_id
    AND pg_catalog.upper(r.network) = v_network
    AND pg_catalog.upper(r.status) = 'RESERVED'
    AND r.reserved_until > pg_catalog.clock_timestamp();

  SELECT pg_catalog.count(*)::INTEGER
    INTO v_matched_count
  FROM public.utxo_reservations AS r
  JOIN LATERAL pg_catalog.jsonb_array_elements(v_inputs) AS i(value)
    ON pg_catalog.lower(r.txid) = pg_catalog.lower(i.value->>'txid')
   AND r.vout = (i.value->>'vout')::INTEGER
  WHERE r.sweep_id = p_sweep_id
    AND pg_catalog.upper(r.network) = v_network
    AND pg_catalog.upper(r.status) = 'RESERVED'
    AND r.reserved_until > pg_catalog.clock_timestamp();

  IF v_reserved_count <> v_input_count OR v_matched_count <> v_input_count THEN
    RAISE EXCEPTION 'Signed transaction inputs must exactly match active UTXO reservations for this sweep'
      USING ERRCODE = '23514';
  END IF;

  IF (v_sweep.signed_tx_hex IS NOT NULL AND v_sweep.signed_tx_hex <> pg_catalog.lower(pg_catalog.btrim(p_signed_tx_hex)))
     OR (v_sweep.sweep_tx_hash IS NOT NULL AND pg_catalog.lower(v_sweep.sweep_tx_hash) <> pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)))
     OR (v_sweep.signed_utxo_intent IS NOT NULL AND v_sweep.signed_utxo_intent IS DISTINCT FROM p_signed_utxo_intent) THEN
    RETURN pg_catalog.jsonb_build_object('success', false, 'code', 'SIGNED_PAYLOAD_OR_INTENT_MUTATION_REJECTED');
  END IF;
  v_lease := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_extend_lease_seconds);
  UPDATE public.sweep_operations SET status = 'READY_TO_BROADCAST',
    signed_tx_hex = pg_catalog.lower(pg_catalog.btrim(p_signed_tx_hex)),
    sweep_tx_hash = pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)),
    signed_utxo_intent = p_signed_utxo_intent,
    lease_expires_at = v_lease, updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_sweep_id AND worker_id = p_worker_id AND status = 'CLAIMED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not persist signed UTXO transaction intent' USING ERRCODE = '55000'; END IF;
  RETURN pg_catalog.jsonb_build_object('success', true, 'sweep_id', p_sweep_id,
    'status', 'READY_TO_BROADCAST', 'sweep_tx_hash', pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash)));
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_signed_sweep_intent_mutation ON public.sweep_operations;
CREATE TRIGGER trg_prevent_signed_sweep_intent_mutation BEFORE UPDATE ON public.sweep_operations
FOR EACH ROW EXECUTE FUNCTION public.prevent_signed_sweep_intent_mutation();
REVOKE ALL ON FUNCTION public.prevent_signed_sweep_intent_mutation() FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.prevent_signed_sweep_intent_mutation() TO postgres;
REVOKE ALL ON FUNCTION public.persist_signed_btc_ltc_transaction(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER)
FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.persist_signed_btc_ltc_transaction(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, INTEGER) TO service_role, postgres;
COMMIT;
