-- Durable TRON sweep signing and safe pre-broadcast retry release.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sweep_operations_sweep_tx_hash
  ON public.sweep_operations (lower(btrim(sweep_tx_hash)))
  WHERE nullif(btrim(sweep_tx_hash), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.persist_signed_tron_sweep_transaction(
  p_sweep_id uuid,
  p_worker_id text,
  p_expected_status text,
  p_signed_tx_json text,
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
  v_signed jsonb;
  v_hash text := lower(btrim(coalesce(p_sweep_tx_hash, '')));
  v_existing_hash text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist signed TRON sweep transactions'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_expected_status NOT IN ('CLAIMED', 'GAS_FUNDED')
     OR p_signed_tx_json IS NULL OR length(p_signed_tx_json) < 20 OR length(p_signed_tx_json) > 1000000
     OR v_hash !~ '^[0-9a-f]{64}$'
     OR p_extend_lease_seconds IS NULL OR p_extend_lease_seconds < 30 OR p_extend_lease_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid signed TRON sweep transaction payload'
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_signed := p_signed_tx_json::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Signed TRON transaction JSON is invalid'
      USING ERRCODE = '22023';
  END;

  IF pg_catalog.jsonb_typeof(v_signed) <> 'object'
     OR lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM v_hash
     OR pg_catalog.jsonb_typeof(v_signed->'signature') <> 'array'
     OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1
     OR nullif(v_signed->>'raw_data_hex', '') IS NULL THEN
    RAISE EXCEPTION 'Signed TRON transaction hash/signature/raw-data validation failed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash, 0));

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'TRON sweep worker does not own a live lease'
      USING ERRCODE = '42501';
  END IF;

  IF upper(coalesce(v_sweep.network, '')) NOT IN ('TRC20', 'TRON')
     OR upper(coalesce(v_sweep.asset_symbol, '')) <> 'USDT' THEN
    RAISE EXCEPTION 'Signed TRON sweep does not match a supported TRC20 USDT operation'
      USING ERRCODE = '22023';
  END IF;

  IF v_sweep.status = 'READY_TO_BROADCAST'
     AND lower(coalesce(v_sweep.sweep_tx_hash, '')) = v_hash
     AND v_sweep.signed_tx_hex = p_signed_tx_json THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'status', v_sweep.status, 'tx_hash', v_hash
    );
  END IF;

  IF v_sweep.status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'TRON sweep status changed before signing persistence (expected %, got %)',
      p_expected_status, v_sweep.status
      USING ERRCODE = '55000';
  END IF;

  IF nullif(btrim(coalesce(v_sweep.sweep_tx_hash, '')), '') IS NOT NULL
     OR nullif(btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'A signed transaction already exists for this sweep; refusing replacement'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.sweep_operations other
    WHERE lower(btrim(coalesce(other.sweep_tx_hash, ''))) = v_hash
      AND other.id <> p_sweep_id
  ) THEN
    RAISE EXCEPTION 'TRON sweep transaction hash is already assigned to another operation'
      USING ERRCODE = '23505';
  END IF;

  UPDATE public.sweep_operations
  SET status = 'READY_TO_BROADCAST',
      sweep_tx_hash = v_hash,
      signed_tx_hex = p_signed_tx_json,
      error_message = NULL,
      lease_expires_at = pg_catalog.clock_timestamp() + (p_extend_lease_seconds * interval '1 second'),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_sweep_id
    AND worker_id = p_worker_id
    AND status = p_expected_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed TRON sweep transaction could not be durably persisted';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'idempotent', false,
    'status', 'READY_TO_BROADCAST', 'tx_hash', v_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_unbroadcast_sweep_for_retry(
  p_sweep_id uuid,
  p_worker_id text,
  p_error_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_delegation_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to release unbroadcast sweeps'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR (p_error_message IS NOT NULL AND length(p_error_message) > 1000) THEN
    RAISE EXCEPTION 'Invalid unbroadcast sweep retry payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND OR v_sweep.worker_id IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Sweep is not owned by this worker'
      USING ERRCODE = '42501';
  END IF;

  IF v_sweep.status NOT IN ('CLAIMED', 'GAS_FUNDING', 'GAS_FUNDED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Sweep in state % cannot be released for retry', v_sweep.status
      USING ERRCODE = '55000';
  END IF;

  IF v_sweep.status <> 'RECOVERY_REQUIRED'
     AND (v_sweep.lease_expires_at IS NULL OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp()) THEN
    RAISE EXCEPTION 'Sweep lease expired before retry release'
      USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(coalesce(v_sweep.sweep_tx_hash, '')), '') IS NOT NULL
     OR nullif(btrim(coalesce(v_sweep.signed_tx_hex, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Sweep has persisted broadcast material; it must be reconciled, not re-queued'
      USING ERRCODE = '55000';
  END IF;

  SELECT status
    INTO v_delegation_status
  FROM public.resource_delegation_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF FOUND AND v_delegation_status NOT IN ('PENDING', 'DELEGATING', 'DELEGATED', 'FAILED') THEN
    RAISE EXCEPTION 'TRON resource delegation is in state %; exact delegation recovery is required before retry release',
      v_delegation_status
      USING ERRCODE = '55000';
  END IF;

  -- Preserve any verified DELEGATED Energy reservation. The next claim reuses
  -- that exact on-chain delegation; this RPC never undelegates or re-funds.
  UPDATE public.sweep_operations
  SET status = 'PENDING',
      worker_id = NULL,
      lease_expires_at = NULL,
      error_message = left(coalesce(nullif(btrim(p_error_message), ''), 'Unbroadcast sweep safely released for retry'), 1000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_sweep_id
    AND worker_id = p_worker_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unbroadcast sweep retry release failed';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'status', 'PENDING',
    'retained_energy_delegation', v_delegation_status = 'DELEGATED'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_signed_tron_sweep_transaction(uuid,text,text,text,text,integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_unbroadcast_sweep_for_retry(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_signed_tron_sweep_transaction(uuid,text,text,text,text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_unbroadcast_sweep_for_retry(uuid,text,text)
  TO service_role;

COMMIT;