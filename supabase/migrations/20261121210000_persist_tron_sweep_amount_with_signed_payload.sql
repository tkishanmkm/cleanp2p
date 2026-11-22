-- Bind the TRC20 sweep amount to the same durable signed-payload transaction.
-- The existing persist_signed_tron_sweep_transaction RPC persists signed JSON/hash
-- and moves the sweep into READY_TO_BROADCAST. This wrapper adds the exact token
-- amount in the same database transaction so recovery never has to infer intent.

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_signed_tron_sweep_transaction_with_amount(
  p_sweep_id UUID,
  p_worker_id TEXT,
  p_expected_status TEXT,
  p_signed_tx_json TEXT,
  p_sweep_tx_hash TEXT,
  p_amount_swept NUMERIC,
  p_extend_lease_seconds INTEGER DEFAULT 300
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist signed TRON sweep intent'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_swept IS NULL
     OR p_amount_swept::TEXT IN ('NaN', 'Infinity', '-Infinity')
     OR p_amount_swept <= 0
     OR p_amount_swept <> round(p_amount_swept, 6) THEN
    RAISE EXCEPTION 'TRON USDT sweep amount must be positive and have at most six decimals'
      USING ERRCODE = '22023';
  END IF;

  v_result := public.persist_signed_tron_sweep_transaction(
    p_sweep_id,
    p_worker_id,
    p_expected_status,
    p_signed_tx_json,
    p_sweep_tx_hash,
    p_extend_lease_seconds
  );

  IF COALESCE((v_result->>'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Underlying durable TRON sweep persistence did not confirm success'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.sweep_operations
  SET amount_swept = p_amount_swept,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_sweep_id
    AND worker_id = p_worker_id
    AND status = 'READY_TO_BROADCAST'
    AND pg_catalog.lower(sweep_tx_hash) = pg_catalog.lower(pg_catalog.btrim(p_sweep_tx_hash))
    AND (amount_swept IS NULL OR amount_swept = p_amount_swept);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TRON sweep amount conflicts with the durable signed operation'
      USING ERRCODE = '23505';
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object('amount_swept', p_amount_swept);
END;
$function$;

REVOKE ALL ON FUNCTION public.persist_signed_tron_sweep_transaction_with_amount(UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_signed_tron_sweep_transaction_with_amount(UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,INTEGER)
  TO service_role;

COMMENT ON FUNCTION public.persist_signed_tron_sweep_transaction_with_amount(UUID,TEXT,TEXT,TEXT,TEXT,NUMERIC,INTEGER)
  IS 'Service-only TRC20 USDT sweep persistence; atomically binds exact signed payload, tx hash, and six-decimal sweep amount before broadcast.';

COMMIT;
