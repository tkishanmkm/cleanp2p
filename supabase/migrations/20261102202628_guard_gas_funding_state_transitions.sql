-- Guard all custodial gas-funding status transitions behind the active sweep lease.
BEGIN;

CREATE OR REPLACE FUNCTION public.update_gas_funding_operation_status(
  p_sweep_id uuid,
  p_worker_id text,
  p_new_status text,
  p_error_message text DEFAULT NULL,
  p_tx_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_gas public.gas_funding_operations%ROWTYPE;
  v_new_status text := upper(pg_catalog.btrim(coalesce(p_new_status, '')));
  v_hash text := nullif(lower(pg_catalog.btrim(coalesce(p_tx_hash, ''))), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to update custodial gas funding'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
     OR v_new_status NOT IN ('BROADCASTED', 'CONFIRMED', 'RECOVERY_REQUIRED', 'FAILED')
     OR (p_error_message IS NOT NULL AND length(p_error_message) > 1000)
     OR (v_hash IS NOT NULL AND v_hash !~ '^(0x)?[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid custodial gas-funding state transition payload'
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
     OR upper(coalesce(v_sweep.status, '')) <> 'GAS_FUNDING' THEN
    RAISE EXCEPTION 'Active GAS_FUNDING sweep lease is not owned by this worker'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_gas
  FROM public.gas_funding_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gas-funding operation does not exist for the sweep'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_hash IS NOT NULL
     AND nullif(lower(pg_catalog.btrim(coalesce(v_gas.tx_hash, ''))), '') IS NOT NULL
     AND lower(pg_catalog.btrim(v_gas.tx_hash)) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Gas-funding operation already contains a different transaction hash'
      USING ERRCODE = '23505';
  END IF;

  IF v_new_status = 'BROADCASTED'
     AND upper(v_gas.status) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Invalid gas-funding transition from % to BROADCASTED', v_gas.status
      USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'CONFIRMED'
     AND upper(v_gas.status) NOT IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED') THEN
    RAISE EXCEPTION 'Invalid gas-funding transition from % to CONFIRMED', v_gas.status
      USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'RECOVERY_REQUIRED'
     AND upper(v_gas.status) NOT IN ('PENDING', 'READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    RAISE EXCEPTION 'Invalid gas-funding transition from % to RECOVERY_REQUIRED', v_gas.status
      USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'FAILED'
     AND upper(v_gas.status) NOT IN ('PENDING', 'RECOVERY_REQUIRED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid gas-funding transition from % to FAILED', v_gas.status
      USING ERRCODE = '55000';
  END IF;

  IF v_new_status = 'CONFIRMED'
     AND coalesce(v_hash, nullif(lower(pg_catalog.btrim(coalesce(v_gas.tx_hash, ''))), '')) IS NULL THEN
    RAISE EXCEPTION 'Cannot confirm gas funding without its persisted transaction hash'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.gas_funding_operations
  SET status = v_new_status,
      worker_id = p_worker_id,
      tx_hash = coalesce(v_hash, tx_hash),
      error_message = CASE
        WHEN p_error_message IS NULL THEN error_message
        ELSE left(p_error_message, 1000)
      END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_gas.id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'status', v_new_status,
    'tx_hash', coalesce(v_hash, v_gas.tx_hash),
    'idempotent', upper(v_gas.status) = v_new_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_gas_funding_operation_status(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_gas_funding_operation_status(uuid,text,text,text,text)
  TO service_role;

COMMIT;