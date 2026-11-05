-- Atomically lease signed sweeps for exact-byte reconciliation without resetting their state.
BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_sweep_reconciliation(
  p_worker_id text,
  p_lease_duration_seconds integer DEFAULT 300
)
RETURNS SETOF public.sweep_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to claim sweep reconciliation'
      USING ERRCODE = '42501';
  END IF;

  IF p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_lease_duration_seconds IS NULL
     OR p_lease_duration_seconds < 30
     OR p_lease_duration_seconds > 1800 THEN
    RAISE EXCEPTION 'Invalid sweep reconciliation lease request'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.id
    INTO v_sweep_id
  FROM public.sweep_operations s
  WHERE s.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED')
    AND nullif(btrim(coalesce(s.sweep_tx_hash, '')), '') IS NOT NULL
    AND nullif(btrim(coalesce(s.signed_tx_hex, '')), '') IS NOT NULL
    AND (s.lease_expires_at IS NULL OR s.lease_expires_at <= pg_catalog.clock_timestamp())
  ORDER BY s.updated_at ASC, s.id ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_sweep_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.sweep_operations
  SET worker_id = p_worker_id,
      lease_expires_at = pg_catalog.clock_timestamp() + (p_lease_duration_seconds * interval '1 second'),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_sweep_id
    AND status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED')
    AND nullif(btrim(coalesce(sweep_tx_hash, '')), '') IS NOT NULL
    AND nullif(btrim(coalesce(signed_tx_hex, '')), '') IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sweep reconciliation lease could not be assigned';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.sweep_operations
  WHERE id = v_sweep_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_next_sweep_reconciliation(text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_sweep_reconciliation(text,integer)
  TO service_role;

COMMIT;