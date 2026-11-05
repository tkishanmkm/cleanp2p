-- Preserve allocated EVM withdrawal nonces until the exact transaction is
-- signed/broadcast or an operator has safely resolved the nonce. A database
-- reservation is not disposable: deleting it after incrementing the shared
-- hot-wallet counter can permanently create an unfillable nonce gap.
BEGIN;

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
  v_network text := upper(pg_catalog.btrim(coalesce(p_network, '')));
  v_nonce bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to reserve withdrawal nonces'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL
     OR p_worker_id IS NULL OR pg_catalog.btrim(p_worker_id) = ''
     OR pg_catalog.length(p_worker_id) > 128
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

    IF v_reservation.status <> 'RESERVED' THEN
      RAISE EXCEPTION 'Nonce reservation is no longer unsigned; exact durable transaction recovery is required'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.onchain_withdrawal_broadcasts b
      WHERE b.withdrawal_id = p_withdrawal_id
    ) THEN
      RAISE EXCEPTION 'A durable broadcast record already exists; replacement signing is prohibited'
        USING ERRCODE = '55000';
    END IF;

    IF p_onchain_pending_nonce > v_reservation.nonce THEN
      RAISE EXCEPTION 'Reserved nonce is already consumed on-chain; automatic re-signing is prohibited'
        USING ERRCODE = '55000';
    END IF;

    -- Return only the same still-unbroadcast nonce. Never allocate a replacement.
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
  ELSIF NEW.status = 'FAILED' AND nullif(pg_catalog.btrim(coalesce(NEW.tx_hash, '')), '') IS NOT NULL THEN
    UPDATE public.onchain_withdrawal_broadcasts
    SET status = 'FAILED', worker_id = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id;

    UPDATE public.onchain_withdrawal_nonce_reservations
    SET status = 'FAILED', updated_at = pg_catalog.clock_timestamp()
    WHERE withdrawal_id = NEW.id
      AND status IN ('SIGNED', 'BROADCASTED', 'RECOVERY_REQUIRED');
  ELSIF NEW.status IN ('FAILED', 'CANCELLED', 'REJECTED')
     AND nullif(pg_catalog.btrim(coalesce(NEW.tx_hash, '')), '') IS NULL THEN
    -- Never discard a reserved EVM nonce after the shared counter advanced.
    -- That would leave a permanent gap and can stall every later hot-wallet tx.
    IF upper(NEW.network) IN ('ERC20', 'BEP20')
       AND EXISTS (
         SELECT 1
         FROM public.onchain_withdrawal_nonce_reservations r
         WHERE r.withdrawal_id = NEW.id
           AND r.status = 'RESERVED'
       ) THEN
      RAISE EXCEPTION 'Unsigned EVM nonce reservation still exists; withdrawal cannot be terminalized or refunded'
        USING ERRCODE = '55000';
    END IF;

    DELETE FROM public.onchain_withdrawal_nonce_reservations
    WHERE withdrawal_id = NEW.id
      AND status = 'RESERVED';
  END IF;

  RETURN NEW;
END;
$function$;

-- The allocator helper is service-only and uses schema-qualified objects.
ALTER FUNCTION public.allocate_hot_wallet_nonce(text, text, bigint)
  SET search_path = '';
ALTER FUNCTION public.allocate_hot_wallet_nonce(integer)
  SET search_path = '';

REVOKE ALL ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)
  TO service_role, postgres;

COMMIT;
