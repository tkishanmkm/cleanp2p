-- Persist two-explorer proof that every input of an ambiguous BTC/LTC sweep
-- was spent by other confirmed transactions. Only then may signed reservations
-- be released: a single "transaction not found" response is never sufficient.
BEGIN;

CREATE TABLE IF NOT EXISTS public.utxo_sweep_conflict_proofs (
  sweep_id UUID NOT NULL REFERENCES public.sweep_operations(id) ON DELETE RESTRICT,
  network TEXT NOT NULL CHECK (network IN ('BTC', 'LTC')),
  input_txid TEXT NOT NULL CHECK (input_txid ~* '^[0-9a-f]{64}$'),
  input_vout INTEGER NOT NULL CHECK (input_vout >= 0),
  conflicting_txid TEXT NOT NULL CHECK (conflicting_txid ~* '^[0-9a-f]{64}$'),
  conflicting_block_hash TEXT NOT NULL CHECK (conflicting_block_hash ~* '^[0-9a-f]{64}$'),
  conflicting_block_height BIGINT NOT NULL CHECK (conflicting_block_height > 0),
  primary_tip_height BIGINT NOT NULL CHECK (primary_tip_height > 0),
  secondary_tip_height BIGINT NOT NULL CHECK (secondary_tip_height > 0),
  primary_source TEXT NOT NULL,
  secondary_source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (sweep_id, input_txid, input_vout),
  CHECK (primary_source <> secondary_source),
  CHECK (
    LEAST(primary_tip_height, secondary_tip_height) - conflicting_block_height + 1
      >= CASE WHEN network = 'BTC' THEN 6 ELSE 12 END
  )
);

ALTER TABLE public.utxo_sweep_conflict_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.utxo_sweep_conflict_proofs
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;


CREATE OR REPLACE FUNCTION public.record_utxo_sweep_conflict_proofs(
  p_sweep_id UUID,
  p_worker_id TEXT,
  p_proofs JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_network TEXT;
  v_inputs JSONB;
  v_item JSONB;
  v_expected_count INTEGER;
  v_seen_count INTEGER := 0;
  v_required_confirmations INTEGER;
  v_input_txid TEXT;
  v_input_vout INTEGER;
  v_conflicting_txid TEXT;
  v_block_hash TEXT;
  v_block_height BIGINT;
  v_primary_tip BIGINT;
  v_secondary_tip BIGINT;
  v_primary_source TEXT;
  v_secondary_source TEXT;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL OR p_worker_id IS NULL
     OR pg_catalog.btrim(p_worker_id) = ''
     OR p_proofs IS NULL
     OR pg_catalog.jsonb_typeof(p_proofs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid UTXO conflict proof request' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()
     OR v_sweep.status NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Active worker lease and reconcilable signed UTXO sweep state are required'
      USING ERRCODE = '42501';
  END IF;

  v_network := pg_catalog.upper(pg_catalog.btrim(coalesce(v_sweep.network, '')));
  IF v_network NOT IN ('BTC', 'LTC')
     OR v_sweep.signed_tx_hex IS NULL
     OR v_sweep.sweep_tx_hash IS NULL
     OR v_sweep.signed_utxo_intent IS NULL THEN
    RAISE EXCEPTION 'Sweep lacks durable BTC/LTC transaction identity and immutable intent'
      USING ERRCODE = '23514';
  END IF;

  v_inputs := v_sweep.signed_utxo_intent->'inputs';
  IF pg_catalog.jsonb_typeof(v_inputs) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_proofs) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Conflict proof inputs and submitted proofs must both be JSON arrays'
      USING ERRCODE = '23514';
  END IF;

  v_expected_count := pg_catalog.jsonb_array_length(v_inputs);
  IF v_expected_count < 1
     OR v_expected_count > 100
     OR pg_catalog.jsonb_array_length(p_proofs) <> v_expected_count THEN
    RAISE EXCEPTION 'Conflict proof set must cover every signed transaction input exactly once'
      USING ERRCODE = '23514';
  END IF;
  v_required_confirmations := CASE WHEN v_network = 'BTC' THEN 6 ELSE 12 END;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_proofs) LOOP
    v_input_txid := pg_catalog.lower(coalesce(v_item->>'input_txid', ''));
    IF coalesce(v_item->>'input_vout', '') !~ '^(0|[1-9][0-9]{0,9})$'
       OR (v_item->>'input_vout')::NUMERIC > 2147483647 THEN
      RAISE EXCEPTION 'Invalid or out-of-range input outpoint in conflict proof' USING ERRCODE = '22023';
    END IF;
    v_input_vout := (v_item->>'input_vout')::INTEGER;
    v_conflicting_txid := pg_catalog.lower(coalesce(v_item->>'conflicting_txid', ''));
    v_block_hash := pg_catalog.lower(coalesce(v_item->>'conflicting_block_hash', ''));
    v_primary_source := coalesce(v_item->>'primary_source', '');
    v_secondary_source := coalesce(v_item->>'secondary_source', '');

    IF v_input_txid !~ '^[0-9a-f]{64}$'
       OR v_conflicting_txid !~ '^[0-9a-f]{64}$'
       OR v_block_hash !~ '^[0-9a-f]{64}$'
       OR v_conflicting_txid = pg_catalog.lower(v_sweep.sweep_tx_hash)
       OR coalesce(v_item->>'conflicting_block_height', '') !~ '^[1-9][0-9]{0,17}$'
       OR coalesce(v_item->>'primary_tip_height', '') !~ '^[1-9][0-9]{0,17}$'
       OR coalesce(v_item->>'secondary_tip_height', '') !~ '^[1-9][0-9]{0,17}$'
       OR pg_catalog.length(v_primary_source) < 3
       OR pg_catalog.length(v_secondary_source) < 3
       OR pg_catalog.lower(v_primary_source) = pg_catalog.lower(v_secondary_source) THEN
      RAISE EXCEPTION 'Malformed or non-independent UTXO conflict proof' USING ERRCODE = '22023';
    END IF;

    v_block_height := (v_item->>'conflicting_block_height')::BIGINT;
    v_primary_tip := (v_item->>'primary_tip_height')::BIGINT;
    v_secondary_tip := (v_item->>'secondary_tip_height')::BIGINT;

    IF v_primary_tip < v_block_height OR v_secondary_tip < v_block_height
       OR LEAST(v_primary_tip, v_secondary_tip) - v_block_height + 1 < v_required_confirmations THEN
      RAISE EXCEPTION 'Conflicting spend has insufficient confirmations on both sources'
        USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_inputs) AS expected(value)
      WHERE pg_catalog.lower(expected.value->>'txid') = v_input_txid
        AND (expected.value->>'vout')::INTEGER = v_input_vout
    ) THEN
      RAISE EXCEPTION 'Conflict proof references an input outside the immutable signed intent'
        USING ERRCODE = '23514';
    END IF;

    v_seen_count := v_seen_count + 1;

    INSERT INTO public.utxo_sweep_conflict_proofs (
      sweep_id, network, input_txid, input_vout,
      conflicting_txid, conflicting_block_hash, conflicting_block_height,
      primary_tip_height, secondary_tip_height, primary_source, secondary_source
    ) VALUES (
      p_sweep_id, v_network, v_input_txid, v_input_vout,
      v_conflicting_txid, v_block_hash, v_block_height,
      v_primary_tip, v_secondary_tip, v_primary_source, v_secondary_source
    )
    ON CONFLICT (sweep_id, input_txid, input_vout) DO UPDATE
    SET conflicting_txid = EXCLUDED.conflicting_txid,
        conflicting_block_hash = EXCLUDED.conflicting_block_hash,
        conflicting_block_height = EXCLUDED.conflicting_block_height,
        primary_tip_height = EXCLUDED.primary_tip_height,
        secondary_tip_height = EXCLUDED.secondary_tip_height,
        primary_source = EXCLUDED.primary_source,
        secondary_source = EXCLUDED.secondary_source,
        recorded_at = pg_catalog.clock_timestamp()
    WHERE public.utxo_sweep_conflict_proofs.network = EXCLUDED.network;
  END LOOP;

  IF v_seen_count <> v_expected_count
     OR (
       SELECT pg_catalog.count(DISTINCT
         pg_catalog.lower(item.value->>'input_txid') || ':' || (item.value->>'input_vout')
       )
       FROM pg_catalog.jsonb_array_elements(p_proofs) AS item(value)
     ) <> v_expected_count
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(v_inputs) AS expected(value)
       WHERE NOT EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_array_elements(p_proofs) AS item(value)
         WHERE pg_catalog.lower(item.value->>'input_txid') = pg_catalog.lower(expected.value->>'txid')
           AND (item.value->>'input_vout')::INTEGER = (expected.value->>'vout')::INTEGER
       )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(p_proofs) AS item(value)
       JOIN public.utxo_sweep_conflict_proofs AS proof
         ON proof.sweep_id = p_sweep_id
        AND proof.input_txid = pg_catalog.lower(item.value->>'input_txid')
        AND proof.input_vout = (item.value->>'input_vout')::INTEGER
       WHERE proof.network <> v_network
          OR proof.conflicting_txid <> pg_catalog.lower(item.value->>'conflicting_txid')
          OR proof.conflicting_block_hash <> pg_catalog.lower(item.value->>'conflicting_block_hash')
          OR proof.conflicting_block_height <> (item.value->>'conflicting_block_height')::BIGINT
          OR proof.primary_tip_height <> (item.value->>'primary_tip_height')::BIGINT
          OR proof.secondary_tip_height <> (item.value->>'secondary_tip_height')::BIGINT
          OR proof.primary_source <> item.value->>'primary_source'
          OR proof.secondary_source <> item.value->>'secondary_source'
          OR proof.recorded_at < pg_catalog.clock_timestamp() - INTERVAL '15 minutes'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM public.utxo_sweep_conflict_proofs
       WHERE sweep_id = p_sweep_id
     ) <> v_expected_count THEN
    RAISE EXCEPTION 'Conflict proof set is incomplete or conflicts with previously recorded evidence'
      USING ERRCODE = '23514';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'sweep_id', p_sweep_id,
    'proof_count', v_expected_count,
    'required_confirmations', v_required_confirmations
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_utxo_sweep_conflict_proofs(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_utxo_sweep_conflict_proofs(UUID, TEXT, JSONB)
  TO service_role, postgres;


-- A signed UTXO sweep may become FAILED only after durable, complete,
-- two-source conflict proof exists for every input in its immutable intent.
CREATE OR REPLACE FUNCTION public.prevent_signed_utxo_sweep_failure()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_proof_count BIGINT;
  v_input_count INTEGER;
BEGIN
  IF pg_catalog.upper(coalesce(OLD.network, '')) IN ('BTC', 'LTC')
     AND NEW.status = 'FAILED'
     AND (OLD.signed_tx_hex IS NOT NULL OR OLD.sweep_tx_hash IS NOT NULL) THEN
    IF OLD.signed_utxo_intent IS NULL
       OR pg_catalog.jsonb_typeof(OLD.signed_utxo_intent->'inputs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Signed BTC/LTC sweep cannot fail without complete conflict proof'
        USING ERRCODE = '55000';
    END IF;

    v_input_count := pg_catalog.jsonb_array_length(OLD.signed_utxo_intent->'inputs');
    SELECT pg_catalog.count(*) INTO v_proof_count
    FROM public.utxo_sweep_conflict_proofs
    WHERE sweep_id = OLD.id
      AND network = pg_catalog.upper(OLD.network)
      AND recorded_at >= pg_catalog.clock_timestamp() - INTERVAL '15 minutes';

    IF v_input_count < 1 OR v_proof_count <> v_input_count THEN
      RAISE EXCEPTION 'Signed BTC/LTC sweep cannot fail until every input is proven spent by a confirmed conflicting transaction'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- Once the parent is atomically failed with complete proof, release only the
-- corresponding held UTXO rows. This also handles seven-day RECOVERY_REQUIRED holds.
CREATE OR REPLACE FUNCTION public.release_proven_conflicted_utxo_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'FAILED'
     AND pg_catalog.upper(coalesce(NEW.network, '')) IN ('BTC', 'LTC')
     AND (NEW.signed_tx_hex IS NOT NULL OR NEW.sweep_tx_hash IS NOT NULL) THEN
    UPDATE public.utxo_reservations
    SET status = 'RELEASED',
        reserved_until = pg_catalog.clock_timestamp()
    WHERE sweep_id = NEW.id
      AND pg_catalog.upper(network) = pg_catalog.upper(NEW.network)
      AND status IN ('RESERVED', 'RECOVERY_REQUIRED');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_proven_conflicted_utxo_reservations
  ON public.sweep_operations;
CREATE TRIGGER trg_release_proven_conflicted_utxo_reservations
AFTER UPDATE OF status ON public.sweep_operations
FOR EACH ROW
WHEN (NEW.status = 'FAILED' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.release_proven_conflicted_utxo_reservations();


-- Permit RELEASED only after the parent is FAILED and complete proof exists.
CREATE OR REPLACE FUNCTION public.protect_signed_utxo_reservation_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent_status TEXT;
  v_parent_network TEXT;
  v_intent JSONB;
  v_signed_tx_hex TEXT;
  v_sweep_tx_hash TEXT;
  v_proof_count BIGINT;
  v_input_count INTEGER;
  v_is_protected BOOLEAN := FALSE;
BEGIN
  SELECT s.status, s.network, s.signed_utxo_intent, s.signed_tx_hex, s.sweep_tx_hash
  INTO v_parent_status, v_parent_network, v_intent, v_signed_tx_hex, v_sweep_tx_hash
  FROM public.sweep_operations AS s
  WHERE s.id = OLD.sweep_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot modify or delete UTXO reservation without its parent sweep'
      USING ERRCODE = '23503';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_signed_tx_hex IS NOT NULL OR v_sweep_tx_hash IS NOT NULL
       OR pg_catalog.upper(coalesce(v_parent_status, '')) IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED') THEN
      RAISE EXCEPTION 'Signed or potentially broadcast UTXO reservation cannot be deleted'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status = 'RELEASED'
     AND pg_catalog.upper(coalesce(v_parent_network, '')) IN ('BTC', 'LTC')
     AND (v_signed_tx_hex IS NOT NULL OR v_sweep_tx_hash IS NOT NULL) THEN
    IF NEW.sweep_id IS DISTINCT FROM OLD.sweep_id
       OR NEW.txid IS DISTINCT FROM OLD.txid
       OR NEW.vout IS DISTINCT FROM OLD.vout
       OR NEW.network IS DISTINCT FROM OLD.network THEN
      RAISE EXCEPTION 'Proof-backed release cannot alter the identity of a reserved outpoint'
        USING ERRCODE = '55000';
    END IF;

    v_input_count := CASE
      WHEN pg_catalog.jsonb_typeof(v_intent->'inputs') = 'array'
      THEN pg_catalog.jsonb_array_length(v_intent->'inputs')
      ELSE 0
    END;
    SELECT pg_catalog.count(*) INTO v_proof_count
    FROM public.utxo_sweep_conflict_proofs
    WHERE sweep_id = OLD.sweep_id
      AND network = pg_catalog.upper(v_parent_network);

    IF v_parent_status <> 'FAILED' OR v_input_count < 1 OR v_proof_count <> v_input_count THEN
      RAISE EXCEPTION 'Signed UTXO reservation cannot be released without complete confirmed conflict proof'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  v_is_protected :=
    v_signed_tx_hex IS NOT NULL
    OR v_sweep_tx_hash IS NOT NULL
    OR pg_catalog.upper(coalesce(v_parent_status, '')) IN (
      'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED'
    );

  IF v_is_protected THEN
    IF NEW.sweep_id IS DISTINCT FROM OLD.sweep_id
       OR NEW.txid IS DISTINCT FROM OLD.txid
       OR NEW.vout IS DISTINCT FROM OLD.vout
       OR NEW.network IS DISTINCT FROM OLD.network
       OR (NEW.reserved_until < OLD.reserved_until AND NEW.status NOT IN ('CONFIRMED', 'RECOVERY_REQUIRED')) THEN
      RAISE EXCEPTION 'Signed UTXO reservation identity cannot be changed, reassigned, or shortened'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'CONFIRMED' AND NEW.status <> 'CONFIRMED' THEN
      RAISE EXCEPTION 'Confirmed UTXO reservation cannot move backwards'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'RECOVERY_REQUIRED'
       AND NEW.status NOT IN ('RECOVERY_REQUIRED', 'CONFIRMED') THEN
      RAISE EXCEPTION 'Recovery-held UTXO reservation cannot be reset or released'
        USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'BROADCASTED'
       AND NEW.status NOT IN ('BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED') THEN
      RAISE EXCEPTION 'Broadcast UTXO reservation cannot move backwards'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_signed_utxo_sweep_failure()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.release_proven_conflicted_utxo_reservations()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.protect_signed_utxo_reservation_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.prevent_signed_utxo_sweep_failure() TO postgres;
GRANT EXECUTE ON FUNCTION public.release_proven_conflicted_utxo_reservations() TO postgres;
GRANT EXECUTE ON FUNCTION public.protect_signed_utxo_reservation_lifecycle() TO postgres;

COMMIT;
