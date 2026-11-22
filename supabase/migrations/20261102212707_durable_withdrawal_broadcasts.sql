-- Durable withdrawal signing, per-withdrawal nonce reuse and lease-based recovery.
BEGIN;

ALTER TABLE public.onchain_withdrawals
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.onchain_withdrawal_broadcasts (
  withdrawal_id uuid PRIMARY KEY
    REFERENCES public.onchain_withdrawals(id) ON DELETE RESTRICT,
  network text NOT NULL,
  signed_tx text NOT NULL,
  tx_hash text NOT NULL,
  nonce bigint,
  worker_id text,
  status text NOT NULL DEFAULT 'READY_TO_BROADCAST',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT onchain_withdrawal_broadcasts_status_check
    CHECK (status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onchain_withdrawal_broadcasts_tx_hash
  ON public.onchain_withdrawal_broadcasts (lower(tx_hash));

CREATE TABLE IF NOT EXISTS public.onchain_withdrawal_nonce_reservations (
  withdrawal_id uuid PRIMARY KEY
    REFERENCES public.onchain_withdrawals(id) ON DELETE RESTRICT,
  network text NOT NULL,
  wallet_address text NOT NULL,
  nonce bigint NOT NULL CHECK (nonce >= 0),
  status text NOT NULL DEFAULT 'RESERVED',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT onchain_withdrawal_nonce_reservations_status_check
    CHECK (status IN ('RESERVED', 'SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED', 'CONFIRMED', 'FAILED', 'RELEASED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_onchain_withdrawal_nonce_wallet_nonce
  ON public.onchain_withdrawal_nonce_reservations (upper(network), lower(wallet_address), nonce)
  WHERE status <> 'RELEASED';

ALTER TABLE public.onchain_withdrawal_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onchain_withdrawal_nonce_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.onchain_withdrawal_broadcasts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.onchain_withdrawal_nonce_reservations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.onchain_withdrawal_broadcasts TO service_role;
GRANT ALL ON TABLE public.onchain_withdrawal_nonce_reservations TO service_role;

-- Legacy PROCESSING rows were created by a dispatcher that broadcasted before
-- persisting a signed payload. They cannot be safely re-signed after a crash.
UPDATE public.onchain_withdrawals
SET status = 'AMBIGUOUS_BROADCAST',
    error_message = 'Legacy PROCESSING withdrawal has no durable signed transaction; manual reconciliation is required.',
    worker_id = NULL,
    lease_expires_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
WHERE status = 'PROCESSING'
  AND worker_id IS NULL
  AND lease_expires_at IS NULL;

UPDATE public.withdrawals mirror
SET status = 'AMBIGUOUS_BROADCAST',
    broadcast_error = 'Legacy PROCESSING withdrawal has no durable signed transaction; manual reconciliation is required.',
    updated_at = pg_catalog.clock_timestamp()
WHERE mirror.id IN (
  SELECT id
  FROM public.onchain_withdrawals
  WHERE status = 'AMBIGUOUS_BROADCAST'
    AND error_message LIKE 'Legacy PROCESSING withdrawal%'
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
            AND b.tx_hash = w.tx_hash
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

CREATE OR REPLACE FUNCTION public.allocate_onchain_withdrawal_nonce(
  p_withdrawal_id uuid,
  p_worker_id text,
  p_network text,
  p_wallet_address text,
  p_onchain_pending_nonce bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_withdrawal public.onchain_withdrawals%ROWTYPE;
  v_reservation public.onchain_withdrawal_nonce_reservations%ROWTYPE;
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_nonce bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to reserve withdrawal nonces'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR v_network NOT IN ('ERC20', 'BEP20')
     OR p_wallet_address IS NULL
     OR p_wallet_address !~* '^0x[0-9a-f]{40}$'
     OR p_onchain_pending_nonce IS NULL
     OR p_onchain_pending_nonce < 0 THEN
    RAISE EXCEPTION 'Invalid on-chain withdrawal nonce reservation payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_withdrawal
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_withdrawal.worker_id IS DISTINCT FROM p_worker_id
     OR v_withdrawal.lease_expires_at IS NULL
     OR v_withdrawal.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(v_withdrawal.network) IS DISTINCT FROM v_network
     OR upper(v_withdrawal.status) <> 'PROCESSING' THEN
    RAISE EXCEPTION 'Active PROCESSING withdrawal lease is required for nonce reservation'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.onchain_withdrawal_nonce_reservations
  WHERE withdrawal_id = p_withdrawal_id
  FOR UPDATE;

  IF FOUND THEN
    IF upper(v_reservation.network) IS DISTINCT FROM v_network
       OR lower(v_reservation.wallet_address) IS DISTINCT FROM lower(p_wallet_address) THEN
      RAISE EXCEPTION 'Existing withdrawal nonce reservation does not match the network/hot wallet'
        USING ERRCODE = '23514';
    END IF;
    IF v_reservation.status IN ('RELEASED', 'FAILED') THEN
      RAISE EXCEPTION 'Withdrawal nonce reservation is terminal and cannot be reused'
        USING ERRCODE = '55000';
    END IF;
    RETURN v_reservation.nonce;
  END IF;

  v_nonce := public.allocate_hot_wallet_nonce(
    v_network,
    p_wallet_address,
    p_onchain_pending_nonce
  );

  IF v_nonce IS NULL OR v_nonce < p_onchain_pending_nonce OR v_nonce > 2147483647 THEN
    RAISE EXCEPTION 'Hot-wallet nonce allocator returned an invalid or out-of-range nonce'
      USING ERRCODE = '22003';
  END IF;

  INSERT INTO public.onchain_withdrawal_nonce_reservations (
    withdrawal_id, network, wallet_address, nonce, status
  )
  VALUES (
    p_withdrawal_id, v_network, lower(p_wallet_address), v_nonce, 'RESERVED'
  );

  RETURN v_nonce;
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_signed_onchain_withdrawal(
  p_withdrawal_id uuid,
  p_worker_id text,
  p_network text,
  p_signed_tx text,
  p_tx_hash text,
  p_nonce bigint DEFAULT NULL,
  p_signer_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_withdrawal public.onchain_withdrawals%ROWTYPE;
  v_payload public.onchain_withdrawal_broadcasts%ROWTYPE;
  v_network text := upper(btrim(coalesce(p_network, '')));
  v_hash text := lower(btrim(coalesce(p_tx_hash, '')));
  v_signed jsonb;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist signed withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR v_network NOT IN ('TRC20', 'ERC20', 'BEP20')
     OR p_signed_tx IS NULL
     OR length(p_signed_tx) < 20 OR length(p_signed_tx) > 1000000
     OR (v_network = 'TRC20' AND v_hash !~ '^[0-9a-f]{64}$')
     OR (v_network IN ('ERC20', 'BEP20') AND v_hash !~ '^0x[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Invalid signed withdrawal transaction payload'
      USING ERRCODE = '22023';
  END IF;

  IF v_network = 'TRC20' THEN
    BEGIN
      v_signed := p_signed_tx::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Signed TRON withdrawal JSON is invalid'
        USING ERRCODE = '22023';
    END;

    IF pg_catalog.jsonb_typeof(v_signed) IS DISTINCT FROM 'object'
       OR lower(coalesce(v_signed->>'txID', '')) IS DISTINCT FROM v_hash
       OR pg_catalog.jsonb_typeof(v_signed->'signature') IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(v_signed->'signature') < 1
       OR nullif(v_signed->>'raw_data_hex', '') IS NULL
       OR p_nonce IS NOT NULL
       OR p_signer_address IS NOT NULL THEN
      RAISE EXCEPTION 'Signed TRON withdrawal hash/signature/raw-data validation failed'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_nonce IS NULL OR p_nonce < 0 OR p_nonce > 2147483647
       OR p_signer_address IS NULL
       OR p_signer_address !~* '^0x[0-9a-f]{40}$'
       OR p_signed_tx !~* '^0x[0-9a-f]+$'
       OR length(p_signed_tx) % 2 <> 0 THEN
      RAISE EXCEPTION 'Signed EVM withdrawal nonce/signer/raw-bytes validation failed'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT *
    INTO v_withdrawal
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_withdrawal.worker_id IS DISTINCT FROM p_worker_id
     OR v_withdrawal.lease_expires_at IS NULL
     OR v_withdrawal.lease_expires_at <= pg_catalog.clock_timestamp()
     OR upper(v_withdrawal.status) <> 'PROCESSING'
     OR upper(v_withdrawal.network) IS DISTINCT FROM v_network
     OR NOT (
       (v_network = 'TRC20' AND upper(v_withdrawal.asset_symbol) = 'USDT')
       OR (v_network IN ('ERC20', 'BEP20') AND upper(v_withdrawal.asset_symbol) = 'USDT')
       OR (v_network = 'ERC20' AND upper(v_withdrawal.asset_symbol) = 'ETH')
     ) THEN
    RAISE EXCEPTION 'Active supported PROCESSING withdrawal lease/network/asset is required to persist signed bytes'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_payload
  FROM public.onchain_withdrawal_broadcasts
  WHERE withdrawal_id = p_withdrawal_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_payload.tx_hash = v_hash
       AND v_payload.signed_tx = p_signed_tx
       AND upper(v_payload.network) = v_network THEN
      UPDATE public.onchain_withdrawal_broadcasts
      SET worker_id = p_worker_id,
          updated_at = pg_catalog.clock_timestamp()
      WHERE withdrawal_id = p_withdrawal_id;

      UPDATE public.onchain_withdrawals
      SET status = 'READY_TO_BROADCAST',
          tx_hash = v_hash,
          nonce = coalesce(p_nonce, nonce),
          lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = p_withdrawal_id;

      RETURN pg_catalog.jsonb_build_object(
        'success', true, 'idempotent', true,
        'status', 'READY_TO_BROADCAST', 'tx_hash', v_hash
      );
    END IF;
    RAISE EXCEPTION 'A different signed withdrawal transaction is already persisted; refusing replacement'
      USING ERRCODE = '23505';
  END IF;

  IF nullif(btrim(coalesce(v_withdrawal.tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal already has a transaction hash but no matching durable signed payload; manual reconciliation is required'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.onchain_withdrawal_broadcasts other
    WHERE lower(other.tx_hash) = v_hash
      AND other.withdrawal_id <> p_withdrawal_id
  ) THEN
    RAISE EXCEPTION 'Signed withdrawal transaction hash is already assigned to another withdrawal'
      USING ERRCODE = '23505';
  END IF;

  IF v_network IN ('ERC20', 'BEP20') THEN
    PERFORM 1
    FROM public.onchain_withdrawal_nonce_reservations r
    WHERE r.withdrawal_id = p_withdrawal_id
      AND upper(r.network) = v_network
      AND lower(r.wallet_address) = lower(p_signer_address)
      AND r.nonce = p_nonce
      AND r.status = 'RESERVED'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A matching durable EVM nonce reservation is required before persisting signed bytes'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  INSERT INTO public.onchain_withdrawal_broadcasts (
    withdrawal_id, network, signed_tx, tx_hash, nonce, worker_id, status
  )
  VALUES (
    p_withdrawal_id, v_network, p_signed_tx, v_hash, p_nonce, p_worker_id, 'READY_TO_BROADCAST'
  );

  UPDATE public.onchain_withdrawals
  SET status = 'READY_TO_BROADCAST',
      tx_hash = v_hash,
      nonce = coalesce(p_nonce, nonce),
      lease_expires_at = pg_catalog.clock_timestamp() + interval '5 minutes',
      error_message = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id
    AND worker_id = p_worker_id
    AND status = 'PROCESSING';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Signed withdrawal was not durably persisted';
  END IF;

  IF v_network IN ('ERC20', 'BEP20') THEN
    UPDATE public.onchain_withdrawal_nonce_reservations
    SET status = 'SIGNED', updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = p_withdrawal_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'idempotent', false,
    'status', 'READY_TO_BROADCAST', 'tx_hash', v_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_onchain_withdrawal_broadcast(
  p_withdrawal_id uuid,
  p_worker_id text,
  p_tx_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_withdrawal public.onchain_withdrawals%ROWTYPE;
  v_payload public.onchain_withdrawal_broadcasts%ROWTYPE;
  v_hash text := lower(btrim(coalesce(p_tx_hash, '')));
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to record withdrawal broadcasts'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = '' OR v_hash = '' OR length(v_hash) > 160 THEN
    RAISE EXCEPTION 'Invalid withdrawal broadcast payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_withdrawal
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_withdrawal.status IN ('COMPLETED', 'CONFIRMED', 'BROADCASTED') THEN
    IF lower(coalesce(v_withdrawal.tx_hash, '')) IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Completed withdrawal transaction hash conflict';
    END IF;
    RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', v_withdrawal.status, 'tx_hash', v_hash);
  END IF;

  IF v_withdrawal.worker_id IS DISTINCT FROM p_worker_id
     OR v_withdrawal.lease_expires_at IS NULL
     OR v_withdrawal.lease_expires_at <= pg_catalog.clock_timestamp()
     OR v_withdrawal.status NOT IN ('READY_TO_BROADCAST', 'AMBIGUOUS_BROADCAST') THEN
    RAISE EXCEPTION 'Active signed withdrawal worker lease is required to record a broadcast'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_payload
  FROM public.onchain_withdrawal_broadcasts
  WHERE withdrawal_id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_payload.worker_id IS DISTINCT FROM p_worker_id
     OR lower(v_payload.tx_hash) IS DISTINCT FROM v_hash
     OR v_payload.signed_tx IS NULL
     OR v_payload.status NOT IN ('READY_TO_BROADCAST', 'RECOVERY_REQUIRED', 'BROADCASTED') THEN
    RAISE EXCEPTION 'Persisted signed withdrawal/hash does not match the active broadcast lease'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.onchain_withdrawal_broadcasts
  SET status = 'BROADCASTED',
      worker_id = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE withdrawal_id = p_withdrawal_id;

  UPDATE public.onchain_withdrawals
  SET status = 'BROADCASTED',
      tx_hash = v_hash,
      worker_id = NULL,
      lease_expires_at = NULL,
      error_message = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  UPDATE public.onchain_withdrawal_nonce_reservations
  SET status = 'BROADCASTED', updated_at = pg_catalog.clock_timestamp()
  WHERE withdrawal_id = p_withdrawal_id
    AND status IN ('SIGNED', 'BROADCASTED');

  UPDATE public.withdrawals
  SET status = 'BROADCASTED',
      tx_hash = v_hash,
      txid = v_hash,
      broadcasted_at = coalesce(broadcasted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Withdrawal mirror broadcast update failed';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'idempotent', false,
    'withdrawal_id', p_withdrawal_id, 'status', 'BROADCASTED', 'tx_hash', v_hash
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_withdrawal_ambiguous_broadcast(
  p_withdrawal_id uuid,
  p_worker_id text,
  p_tx_hash text,
  p_error_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_withdrawal public.onchain_withdrawals%ROWTYPE;
  v_payload public.onchain_withdrawal_broadcasts%ROWTYPE;
  v_hash text := lower(btrim(coalesce(p_tx_hash, '')));
  v_reason text := left(coalesce(nullif(btrim(p_error_reason), ''), 'Ambiguous signed withdrawal broadcast; exact-byte recovery required'), 1000);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to mark ambiguous withdrawal broadcasts'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR p_worker_id IS NULL OR btrim(p_worker_id) = '' OR v_hash = '' OR length(v_hash) > 160 THEN
    RAISE EXCEPTION 'Ambiguous withdrawal requires its persisted transaction hash'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_withdrawal
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_withdrawal.status = 'BROADCASTED'
     AND lower(coalesce(v_withdrawal.tx_hash, '')) = v_hash THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'BROADCASTED', 'tx_hash', v_hash
    );
  END IF;

  IF v_withdrawal.worker_id IS DISTINCT FROM p_worker_id
     OR v_withdrawal.lease_expires_at IS NULL
     OR v_withdrawal.lease_expires_at <= pg_catalog.clock_timestamp()
     OR v_withdrawal.status NOT IN ('READY_TO_BROADCAST', 'AMBIGUOUS_BROADCAST') THEN
    RAISE EXCEPTION 'Active signed withdrawal lease is required to mark ambiguity'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_payload
  FROM public.onchain_withdrawal_broadcasts
  WHERE withdrawal_id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_payload.worker_id IS DISTINCT FROM p_worker_id
     OR lower(v_payload.tx_hash) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Ambiguous withdrawal requires the exact persisted signed transaction'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.onchain_withdrawal_broadcasts
  SET status = 'RECOVERY_REQUIRED',
      worker_id = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE withdrawal_id = p_withdrawal_id;

  UPDATE public.onchain_withdrawal_nonce_reservations
  SET status = 'RECOVERY_REQUIRED', updated_at = pg_catalog.clock_timestamp()
  WHERE withdrawal_id = p_withdrawal_id
    AND status IN ('SIGNED', 'BROADCASTED');

  UPDATE public.onchain_withdrawals
  SET status = 'AMBIGUOUS_BROADCAST',
      tx_hash = v_hash,
      worker_id = NULL,
      lease_expires_at = NULL,
      error_message = v_reason,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  UPDATE public.withdrawals
  SET status = 'AMBIGUOUS_BROADCAST',
      tx_hash = v_hash,
      txid = v_hash,
      broadcast_error = v_reason,
      broadcasted_at = coalesce(broadcasted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', 'AMBIGUOUS_BROADCAST', 'tx_hash', v_hash
  );
END;
$function$;

-- Mark private nonce reservation and signature payload terminal only after the
-- canonical withdrawal state has been atomically settled.
CREATE OR REPLACE FUNCTION public.sync_onchain_withdrawal_broadcast_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('COMPLETED', 'CONFIRMED') THEN
    UPDATE public.onchain_withdrawal_broadcasts
    SET status = 'CONFIRMED', worker_id = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id;

    UPDATE public.onchain_withdrawal_nonce_reservations
    SET status = 'CONFIRMED', updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id
      AND status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
  ELSIF NEW.status = 'FAILED' AND nullif(btrim(coalesce(NEW.tx_hash, '')), '') IS NOT NULL THEN
    UPDATE public.onchain_withdrawal_broadcasts
    SET status = 'FAILED', worker_id = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id;

    UPDATE public.onchain_withdrawal_nonce_reservations
    SET status = 'FAILED', updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id
      AND status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
  ELSIF NEW.status IN ('FAILED', 'CANCELLED', 'REJECTED')
     AND nullif(btrim(coalesce(NEW.tx_hash, '')), '') IS NULL THEN
    DELETE FROM public.onchain_withdrawal_nonce_reservations
    WHERE withdrawal_id = NEW.id
      AND status = 'RESERVED';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_onchain_withdrawal_broadcast_state
  ON public.onchain_withdrawals;

CREATE TRIGGER trg_sync_onchain_withdrawal_broadcast_state
AFTER UPDATE OF status ON public.onchain_withdrawals
FOR EACH ROW
EXECUTE FUNCTION public.sync_onchain_withdrawal_broadcast_state();

-- The old signatures cannot bypass the lease/persisted-byte requirements.
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_onchain_withdrawal_broadcast(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_withdrawal_ambiguous_broadcast(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_signed_onchain_withdrawal(uuid,text,text,text,text,bigint,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_onchain_withdrawal_broadcast(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_withdrawal_ambiguous_broadcast(uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_signed_onchain_withdrawal(uuid,text,text,text,text,bigint,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_onchain_withdrawal_broadcast(uuid,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_ambiguous_broadcast(uuid,text,text,text)
  TO service_role;

COMMIT;