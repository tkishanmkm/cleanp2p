-- Fence any legacy PROCESSING withdrawal that has a tx hash but no durable raw payload.
BEGIN;

UPDATE public.onchain_withdrawals w
SET status = 'AMBIGUOUS_BROADCAST',
    worker_id = NULL,
    lease_expires_at = NULL,
    error_message = 'Withdrawal has a transaction hash but no durable signed payload; automatic rebroadcast is disabled pending manual reconciliation.',
    updated_at = pg_catalog.clock_timestamp()
WHERE w.status = 'PROCESSING'
  AND nullif(btrim(coalesce(w.tx_hash, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.onchain_withdrawal_broadcasts b
    WHERE b.withdrawal_id = w.id
      AND lower(b.tx_hash) = lower(w.tx_hash)
      AND nullif(btrim(coalesce(b.signed_tx, '')), '') IS NOT NULL
  );

UPDATE public.withdrawals mirror
SET status = 'AMBIGUOUS_BROADCAST',
    broadcast_error = 'Withdrawal has a transaction hash but no durable signed payload; automatic rebroadcast is disabled pending manual reconciliation.',
    updated_at = pg_catalog.clock_timestamp()
WHERE mirror.id IN (
  SELECT w.id
  FROM public.onchain_withdrawals w
  WHERE w.status = 'AMBIGUOUS_BROADCAST'
    AND w.error_message LIKE 'Withdrawal has a transaction hash but no durable signed payload%'
);

CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(
  p_limit integer DEFAULT 10,
  p_worker_id text DEFAULT NULL
)
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_limit integer := least(10, greatest(1, coalesce(p_limit, 1)));
  v_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to claim withdrawal queue'
      USING ERRCODE = '42501';
  END IF;

  IF p_worker_id IS NULL
     OR btrim(p_worker_id) = ''
     OR length(p_worker_id) > 128 THEN
    RAISE EXCEPTION 'A valid withdrawal worker ID is required'
      USING ERRCODE = '22023';
  END IF;

  WITH candidates AS (
    SELECT w.id
    FROM public.onchain_withdrawals w
    WHERE (
      (
        w.status = 'PENDING'
        AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= pg_catalog.clock_timestamp())
      ) OR (
        w.status = 'PROCESSING'
        AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= pg_catalog.clock_timestamp())
        AND nullif(btrim(coalesce(w.tx_hash, '')), '') IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.onchain_withdrawal_broadcasts b
          WHERE b.withdrawal_id = w.id
        )
      ) OR (
        w.status IN ('READY_TO_BROADCAST', 'AMBIGUOUS_BROADCAST')
        AND (w.lease_expires_at IS NULL OR w.lease_expires_at <= pg_catalog.clock_timestamp())
        AND EXISTS (
          SELECT 1
          FROM public.onchain_withdrawal_broadcasts b
          WHERE b.withdrawal_id = w.id
            AND b.status IN ('READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED')
            AND lower(b.tx_hash) = lower(w.tx_hash)
            AND nullif(btrim(coalesce(b.signed_tx, '')), '') IS NOT NULL
        )
      )
    )
    AND (
      (w.network = 'TRC20' AND w.asset_symbol = 'USDT')
      OR (w.network IN ('ERC20', 'BEP20') AND w.asset_symbol = 'USDT')
      OR (w.network = 'ERC20' AND w.asset_symbol = 'ETH')
    )
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.onchain_withdrawals w
    SET status = CASE WHEN w.status = 'PENDING' THEN 'PROCESSING' ELSE w.status END,
        worker_id = p_worker_id,
        lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates c
    WHERE w.id = c.id
    RETURNING w.id
  )
  SELECT coalesce(pg_catalog.array_agg(id), ARRAY[]::uuid[])
    INTO v_ids
  FROM claimed;

  IF pg_catalog.cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.onchain_withdrawal_broadcasts b
  SET worker_id = p_worker_id,
      updated_at = pg_catalog.clock_timestamp()
  WHERE b.withdrawal_id = ANY(v_ids)
    AND b.status IN ('READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED');

  UPDATE public.withdrawals mirror
  SET status = 'processing',
      updated_at = pg_catalog.clock_timestamp()
  WHERE mirror.id = ANY(v_ids)
    AND lower(coalesce(mirror.status, '')) IN (
      'queued', 'pending', 'approved', 'processing',
      'broadcasted', 'ambiguous_broadcast'
    );
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> pg_catalog.cardinality(v_ids) THEN
    RAISE EXCEPTION 'Withdrawal mirror queue claim mismatch: expected %, updated %',
      pg_catalog.cardinality(v_ids), v_rows;
  END IF;

  RETURN QUERY
  SELECT w.*
  FROM public.onchain_withdrawals w
  WHERE w.id = ANY(v_ids)
  ORDER BY w.created_at ASC, w.id ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer,text)
  TO service_role;

COMMIT;