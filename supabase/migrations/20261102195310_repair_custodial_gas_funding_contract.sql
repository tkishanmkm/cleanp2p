-- Production custodial gas-funding contract repair.
-- Adds durable fee fields and restores the worker RPCs without changing wallet balances.
BEGIN;

ALTER TABLE public.gas_funding_operations
  ADD COLUMN IF NOT EXISTS funding_tx_fee numeric(36,18),
  ADD COLUMN IF NOT EXISTS child_sweep_fee numeric(36,18),
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE INDEX IF NOT EXISTS idx_gas_funding_address_network_created
  ON public.gas_funding_operations (deposit_address, network, created_at DESC);

CREATE OR REPLACE FUNCTION public.claim_gas_funding_operation(
  p_sweep_id uuid,
  p_deposit_address text,
  p_network text,
  p_amount_allocated numeric,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_gas public.gas_funding_operations%ROWTYPE;
  v_network text;
  v_sweep_network text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for custodial gas funding'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_deposit_address IS NULL OR btrim(p_deposit_address) = ''
     OR p_network IS NULL OR btrim(p_network) = ''
     OR p_amount_allocated IS NULL OR p_amount_allocated <= 0
     OR p_amount_allocated >= 1000000000000000000 THEN
    RAISE EXCEPTION 'Invalid custodial gas-funding claim payload'
      USING ERRCODE = '22023';
  END IF;

  v_network := CASE upper(btrim(p_network))
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'ETHEREUM' THEN 'ERC20'
    WHEN 'BSC' THEN 'BEP20'
    WHEN 'BINANCE' THEN 'BEP20'
    ELSE upper(btrim(p_network))
  END;

  IF v_network NOT IN ('ERC20', 'BEP20', 'TRC20') THEN
    RAISE EXCEPTION 'Unsupported custodial gas-funding network %', v_network
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_sweep
  FROM public.sweep_operations
  WHERE id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gas-funding sweep operation does not exist'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_sweep.worker_id IS DISTINCT FROM p_worker_id
     OR v_sweep.lease_expires_at IS NULL
     OR v_sweep.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Gas-funding worker does not own a live sweep lease'
      USING ERRCODE = '42501';
  END IF;

  IF upper(coalesce(v_sweep.status, '')) <> 'GAS_FUNDING' THEN
    RAISE EXCEPTION 'Sweep is not in GAS_FUNDING state'
      USING ERRCODE = '55000';
  END IF;

  v_sweep_network := CASE upper(btrim(v_sweep.network))
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'ETHEREUM' THEN 'ERC20'
    WHEN 'BSC' THEN 'BEP20'
    WHEN 'BINANCE' THEN 'BEP20'
    ELSE upper(btrim(v_sweep.network))
  END;

  IF v_sweep_network IS DISTINCT FROM v_network
     OR v_sweep.deposit_address IS DISTINCT FROM p_deposit_address THEN
    RAISE EXCEPTION 'Gas-funding request does not match the claimed sweep destination/network'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_gas
  FROM public.gas_funding_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_gas.deposit_address IS DISTINCT FROM p_deposit_address
       OR upper(v_gas.network) IS DISTINCT FROM v_network THEN
      RAISE EXCEPTION 'Existing gas-funding operation does not match this sweep'
        USING ERRCODE = '23514';
    END IF;

    IF v_gas.status = 'CONFIRMED' THEN
      IF nullif(btrim(coalesce(v_gas.tx_hash, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Confirmed gas-funding operation has no transaction hash; reconciliation required';
      END IF;
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'already_funded', true,
        'status', v_gas.status,
        'tx_hash', v_gas.tx_hash,
        'signed_tx_hex', v_gas.signed_tx_hex,
        'nonce', v_gas.nonce,
        'amount_allocated', v_gas.amount_allocated
      );
    END IF;

    IF v_gas.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
      IF nullif(btrim(coalesce(v_gas.tx_hash, '')), '') IS NULL
         OR nullif(btrim(coalesce(v_gas.signed_tx_hex, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Persisted gas-funding transaction is incomplete; reconciliation required before another funding attempt';
      END IF;
      RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'already_funded', false,
        'needs_reconciliation', true,
        'status', v_gas.status,
        'tx_hash', v_gas.tx_hash,
        'signed_tx_hex', v_gas.signed_tx_hex,
        'nonce', v_gas.nonce,
        'amount_allocated', v_gas.amount_allocated
      );
    END IF;

    IF v_gas.status <> 'PENDING' THEN
      RAISE EXCEPTION 'Gas-funding operation is in non-retryable state %', v_gas.status
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.gas_funding_operations
    SET amount_allocated = p_amount_allocated,
        worker_id = p_worker_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = v_gas.id
    RETURNING * INTO v_gas;
  ELSE
    INSERT INTO public.gas_funding_operations (
      sweep_id, deposit_address, network, amount_allocated,
      status, worker_id, created_at, updated_at
    )
    VALUES (
      p_sweep_id, p_deposit_address, v_network, p_amount_allocated,
      'PENDING', p_worker_id, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    )
    RETURNING * INTO v_gas;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'already_funded', false,
    'status', v_gas.status,
    'tx_hash', v_gas.tx_hash,
    'signed_tx_hex', v_gas.signed_tx_hex,
    'nonce', v_gas.nonce,
    'amount_allocated', v_gas.amount_allocated
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_signed_gas_funding(
  p_sweep_id uuid,
  p_worker_id text,
  p_signed_tx_hex text,
  p_tx_hash text,
  p_nonce bigint DEFAULT NULL,
  p_funding_tx_fee numeric DEFAULT NULL,
  p_child_sweep_fee numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_sweep public.sweep_operations%ROWTYPE;
  v_gas public.gas_funding_operations%ROWTYPE;
  v_hash text := lower(btrim(coalesce(p_tx_hash, '')));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to persist signed gas-funding transactions'
      USING ERRCODE = '42501';
  END IF;

  IF p_sweep_id IS NULL
     OR p_worker_id IS NULL OR btrim(p_worker_id) = ''
     OR p_signed_tx_hex IS NULL OR length(btrim(p_signed_tx_hex)) < 10
     OR length(p_signed_tx_hex) > 1000000
     OR v_hash !~ '^(0x)?[0-9a-f]{64}$'
     OR (p_nonce IS NOT NULL AND p_nonce < 0)
     OR (p_funding_tx_fee IS NOT NULL AND p_funding_tx_fee < 0)
     OR (p_child_sweep_fee IS NOT NULL AND p_child_sweep_fee < 0) THEN
    RAISE EXCEPTION 'Invalid signed gas-funding transaction payload'
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
    RAISE EXCEPTION 'Worker does not own an active GAS_FUNDING sweep lease'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_gas
  FROM public.gas_funding_operations
  WHERE sweep_id = p_sweep_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gas-funding claim must be persisted before signing'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_gas.worker_id IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'Gas-funding operation is not owned by the current worker'
      USING ERRCODE = '42501';
  END IF;

  IF v_gas.status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'RECOVERY_REQUIRED') THEN
    IF lower(coalesce(v_gas.tx_hash, '')) = v_hash
       AND v_gas.signed_tx_hex = btrim(p_signed_tx_hex) THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true, 'idempotent', true,
        'status', v_gas.status, 'tx_hash', v_hash, 'nonce', v_gas.nonce
      );
    END IF;
    RAISE EXCEPTION 'A different signed gas-funding transaction is already persisted; refusing replacement'
      USING ERRCODE = '23505';
  END IF;

  IF v_gas.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Gas-funding operation cannot persist a transaction from state %', v_gas.status
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.gas_funding_operations
  SET signed_tx_hex = btrim(p_signed_tx_hex),
      tx_hash = v_hash,
      nonce = coalesce(p_nonce, nonce),
      funding_tx_fee = coalesce(p_funding_tx_fee, funding_tx_fee),
      child_sweep_fee = coalesce(p_child_sweep_fee, child_sweep_fee),
      status = 'READY_TO_BROADCAST',
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_gas.id
  RETURNING * INTO v_gas;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'idempotent', false,
    'status', v_gas.status, 'tx_hash', v_hash, 'nonce', v_gas.nonce
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_gas_funding_eligibility(
  p_deposit_address text,
  p_network text,
  p_amount_allocated numeric,
  p_cooldown_seconds integer DEFAULT 300,
  p_daily_limit numeric DEFAULT 0.05,
  p_daily_max_operations integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_network text;
  v_recent record;
  v_daily_count integer := 0;
  v_daily_total numeric(36,18) := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for gas-funding eligibility'
      USING ERRCODE = '42501';
  END IF;

  IF p_deposit_address IS NULL OR btrim(p_deposit_address) = ''
     OR p_network IS NULL OR btrim(p_network) = ''
     OR p_amount_allocated IS NULL OR p_amount_allocated <= 0
     OR p_cooldown_seconds IS NULL OR p_cooldown_seconds < 0 OR p_cooldown_seconds > 86400
     OR p_daily_limit IS NULL OR p_daily_limit <= 0
     OR p_daily_max_operations IS NULL OR p_daily_max_operations < 1 OR p_daily_max_operations > 100 THEN
    RAISE EXCEPTION 'Invalid gas-funding eligibility parameters'
      USING ERRCODE = '22023';
  END IF;

  v_network := CASE upper(btrim(p_network))
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'ETHEREUM' THEN 'ERC20'
    WHEN 'BSC' THEN 'BEP20'
    WHEN 'BINANCE' THEN 'BEP20'
    ELSE upper(btrim(p_network))
  END;

  IF v_network NOT IN ('ERC20', 'BEP20', 'TRC20') THEN
    RAISE EXCEPTION 'Unsupported gas-funding eligibility network %', v_network
      USING ERRCODE = '22023';
  END IF;

  SELECT id, status, created_at, tx_hash
    INTO v_recent
  FROM public.gas_funding_operations
  WHERE deposit_address = p_deposit_address
    AND upper(network) = v_network
    AND status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'RECOVERY_REQUIRED')
    AND created_at >= v_now - (p_cooldown_seconds * interval '1 second')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', 'COOLDOWN_ACTIVE',
      'message', 'A recent gas-funding operation already exists for this address',
      'recent_op_id', v_recent.id,
      'recent_tx_hash', v_recent.tx_hash
    );
  END IF;

  SELECT count(*)::integer, coalesce(sum(amount_allocated), 0)
    INTO v_daily_count, v_daily_total
  FROM public.gas_funding_operations
  WHERE deposit_address = p_deposit_address
    AND upper(network) = v_network
    AND status IN ('READY_TO_BROADCAST', 'BROADCASTED', 'CONFIRMED', 'RECOVERY_REQUIRED')
    AND created_at >= v_now - interval '24 hours';

  IF v_daily_count >= p_daily_max_operations THEN
    RETURN pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', 'DAILY_MAX_OPS_EXCEEDED',
      'daily_count', v_daily_count
    );
  END IF;

  IF v_daily_total + p_amount_allocated > p_daily_limit THEN
    RETURN pg_catalog.jsonb_build_object(
      'eligible', false,
      'reason', 'DAILY_CEILING_EXCEEDED',
      'daily_total', v_daily_total,
      'requested', p_amount_allocated,
      'daily_limit', p_daily_limit
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'eligible', true,
    'daily_count', v_daily_count,
    'daily_total', v_daily_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_gas_funding_operation(uuid,text,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.persist_signed_gas_funding(uuid,text,text,text,bigint,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_gas_funding_eligibility(text,text,numeric,integer,numeric,integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_gas_funding_operation(uuid,text,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.persist_signed_gas_funding(uuid,text,text,text,bigint,numeric,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_gas_funding_eligibility(text,text,numeric,integer,numeric,integer) TO service_role;

-- Keep external payouts and gas-funded sweeps paused until the custodial keys,
-- wallets, user ownership, and worker deployment are reconciled.
UPDATE public.platform_settings
SET withdrawals_enabled = false,
    global_kill_switch_active = true,
    updated_at = pg_catalog.clock_timestamp()
WHERE id = 1;

INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('prevent_withdrawals', 'true'::jsonb, pg_catalog.clock_timestamp())
ON CONFLICT (key) DO UPDATE
SET value = 'true'::jsonb,
    updated_at = pg_catalog.clock_timestamp();

COMMIT;