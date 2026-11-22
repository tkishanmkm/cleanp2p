-- Align the full withdrawal state machine with the production schema.
-- Pooled hot-wallet payouts do not depend on a customer's deposit-address row.
-- BTC/LTC on-chain payouts remain disabled until a canonical UTXO dispatcher exists.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS withdrawal_approval_threshold_usd numeric(18,2) NOT NULL DEFAULT 2000.00,
  ADD COLUMN IF NOT EXISTS withdrawal_fee_multiplier numeric(10,4) NOT NULL DEFAULT 2.0000;

ALTER TABLE public.onchain_withdrawals
  ALTER COLUMN wallet_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS usd_equivalent numeric(18,2);

ALTER TABLE public.ledger_entries
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_key_uidx
  ON public.withdrawals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_idempotency_key_uidx
  ON public.ledger_entries (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS withdrawals_user_created_at_daily_limit_idx
  ON public.withdrawals (user_id, created_at DESC);

-- Fail closed if the governance singleton has not been materialized.
INSERT INTO public.platform_settings (
  id, withdrawals_enabled, global_kill_switch_active,
  max_single_withdrawal_usd, daily_withdrawal_limit_usd,
  withdrawal_approval_threshold_usd, withdrawal_fee_multiplier,
  password_change_withdrawal_hold_hours, updated_at
)
VALUES (1, FALSE, TRUE, 4000.00, 10000.00, 2000.00, 2.0000, 24.00, pg_catalog.now())
ON CONFLICT (id) DO NOTHING;

-- The canonical request RPC writes only columns that exist in production.
-- wallets is a per-chain address container; wallet_assets is the balance authority.
CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id uuid,
  p_network text,
  p_to_address text,
  p_amount numeric,
  p_fee numeric,
  p_asset text DEFAULT 'USDT',
  p_usd_equivalent numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_network text;
  v_asset text;
  v_asset_decimals integer;
  v_wallet_chain text;
  v_wallet_id uuid;
  v_withdrawal_id uuid := pg_catalog.gen_random_uuid();
  v_status text;
  v_requires_approval boolean;
  v_profile record;
  v_settings record;
  v_setting jsonb;
  v_prevent_withdrawals boolean;
  v_emergency_mode boolean;
  v_available numeric(36,18);
  v_in_withdrawal numeric(36,18);
  v_total numeric(36,18);
  v_daily_total numeric(36,18);
  v_hold_hours numeric;
  v_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for withdrawal reservation'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL
     OR p_network IS NULL OR pg_catalog.btrim(p_network) = ''
     OR p_to_address IS NULL OR pg_catalog.btrim(p_to_address) = ''
     OR p_amount IS NULL OR p_amount <= 0
     OR p_fee IS NULL OR p_fee < 0
     OR p_usd_equivalent IS NULL OR p_usd_equivalent <= 0
     OR p_asset IS NULL OR pg_catalog.btrim(p_asset) = '' THEN
    RAISE EXCEPTION 'Invalid withdrawal reservation request'
      USING ERRCODE = '22023';
  END IF;

  v_network := upper(pg_catalog.btrim(p_network));
  v_asset := upper(pg_catalog.btrim(p_asset));

  v_network := CASE v_network
    WHEN 'TRON' THEN 'TRC20'
    WHEN 'ETH' THEN 'ERC20'
    WHEN 'ETHEREUM' THEN 'ERC20'
    WHEN 'BSC' THEN 'BEP20'
    WHEN 'BINANCE' THEN 'BEP20'
    ELSE v_network
  END;

  -- Only networks the canonical withdrawal worker can actually sign and broadcast.
  IF NOT (
    (v_asset = 'USDT' AND v_network IN ('TRC20', 'ERC20', 'BEP20'))
    OR (v_asset = 'ETH' AND v_network = 'ERC20')
  ) THEN
    RAISE EXCEPTION 'Unsupported external withdrawal asset/network pair: %/%', v_asset, v_network
      USING ERRCODE = '22023';
  END IF;

  v_asset_decimals := CASE
    WHEN v_asset = 'ETH' OR (v_asset = 'USDT' AND v_network = 'BEP20') THEN 18
    ELSE 6
  END;
  IF p_amount <> pg_catalog.trunc(p_amount, v_asset_decimals) THEN
    RAISE EXCEPTION 'Withdrawal amount exceeds token precision (% decimal places)', v_asset_decimals
      USING ERRCODE = '22023';
  END IF;

  IF pg_catalog.length(pg_catalog.btrim(p_to_address)) > 180 THEN
    RAISE EXCEPTION 'Withdrawal destination address is too long'
      USING ERRCODE = '22023';
  END IF;

  -- The independent system switches and governance row must both exist and allow withdrawals.
  SELECT value INTO v_setting
  FROM public.system_settings
  WHERE key = 'prevent_withdrawals';

  IF NOT FOUND OR v_setting IS NULL OR pg_catalog.jsonb_typeof(v_setting) NOT IN ('boolean', 'string') THEN
    RAISE EXCEPTION 'Withdrawal system control is unavailable; withdrawal rejected'
      USING ERRCODE = 'P0001';
  END IF;
  v_prevent_withdrawals := (v_setting #>> '{}')::boolean;

  SELECT value INTO v_setting
  FROM public.system_settings
  WHERE key = 'emergency_mode';

  IF NOT FOUND OR v_setting IS NULL OR pg_catalog.jsonb_typeof(v_setting) NOT IN ('boolean', 'string') THEN
    RAISE EXCEPTION 'Emergency control is unavailable; withdrawal rejected'
      USING ERRCODE = 'P0001';
  END IF;
  v_emergency_mode := (v_setting #>> '{}')::boolean;

  IF v_prevent_withdrawals OR v_emergency_mode THEN
    RAISE EXCEPTION 'Platform withdrawal pause is active'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_settings
  FROM public.platform_settings
  WHERE id = 1
  FOR SHARE;

  IF NOT FOUND
     OR v_settings.withdrawals_enabled IS DISTINCT FROM TRUE
     OR v_settings.global_kill_switch_active IS DISTINCT FROM FALSE
     OR v_settings.max_single_withdrawal_usd IS NULL
     OR v_settings.max_single_withdrawal_usd <= 0
     OR v_settings.daily_withdrawal_limit_usd IS NULL
     OR v_settings.daily_withdrawal_limit_usd <= 0
     OR v_settings.withdrawal_approval_threshold_usd IS NULL
     OR v_settings.withdrawal_approval_threshold_usd <= 0
     OR v_settings.withdrawal_fee_multiplier IS NULL
     OR v_settings.withdrawal_fee_multiplier < 0.5
     OR v_settings.withdrawal_fee_multiplier > 10
     OR v_settings.password_change_withdrawal_hold_hours IS NULL
     OR v_settings.password_change_withdrawal_hold_hours < 1
     OR v_settings.password_change_withdrawal_hold_hours > 168 THEN
    RAISE EXCEPTION 'Platform withdrawal governance settings are unavailable or disabled'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_usd_equivalent > v_settings.max_single_withdrawal_usd THEN
    RAISE EXCEPTION 'Maximum single withdrawal limit exceeded'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the profile row to serialize the user's daily-limit / approval checks.
  SELECT id, kyc_status, is_banned, is_on_hold, is_withdrawal_locked,
         is_emergency_frozen, is_suspended, is_restricted, withdrawals_disabled,
         is_kyc_locked, is_minor_restricted, status, account_status, password_changed_at
    INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF coalesce(v_profile.is_banned, false)
     OR coalesce(v_profile.is_on_hold, false)
     OR coalesce(v_profile.is_withdrawal_locked, false)
     OR coalesce(v_profile.is_emergency_frozen, false)
     OR coalesce(v_profile.is_suspended, false)
     OR coalesce(v_profile.is_restricted, false)
     OR coalesce(v_profile.withdrawals_disabled, false)
     OR coalesce(v_profile.is_kyc_locked, false)
     OR coalesce(v_profile.is_minor_restricted, false)
     OR lower(coalesce(v_profile.status::text, '')) IN ('restricted', 'frozen', 'banned', 'suspended', 'closed')
     OR lower(coalesce(v_profile.account_status, '')) IN ('restricted', 'frozen', 'banned', 'suspended', 'closed') THEN
    RAISE EXCEPTION 'Account is restricted from withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF lower(coalesce(v_profile.kyc_status, '')) NOT IN ('approved', 'verified') THEN
    RAISE EXCEPTION 'Tier 2 identity verification is required for withdrawals'
      USING ERRCODE = '42501';
  END IF;

  v_hold_hours := v_settings.password_change_withdrawal_hold_hours;
  IF v_profile.password_changed_at IS NOT NULL
     AND v_profile.password_changed_at > pg_catalog.now() - (v_hold_hours * interval '1 hour') THEN
    RAISE EXCEPTION 'Withdrawal security hold is active after password change'
      USING ERRCODE = '42501';
  END IF;

  -- One pending admin-approved withdrawal per account.
  IF EXISTS (
    SELECT 1
    FROM public.withdrawals w
    WHERE w.user_id = p_user_id
      AND lower(coalesce(w.status, '')) IN ('pending_approval', 'needs_approval')
  ) THEN
    RAISE EXCEPTION 'A previous withdrawal is awaiting administrator approval'
      USING ERRCODE = '55P03';
  END IF;

  -- Missing USD values on an active historical withdrawal make the rolling limit unverifiable.
  IF EXISTS (
    SELECT 1
    FROM public.withdrawals w
    WHERE w.user_id = p_user_id
      AND w.created_at >= pg_catalog.now() - interval '24 hours'
      AND lower(coalesce(w.status, '')) IN (
        'pending', 'pending_approval', 'needs_approval', 'queued', 'approved',
        'processing', 'broadcasting', 'broadcasted', 'ambiguous_broadcast',
        'confirmed', 'completed'
      )
      AND w.usd_equivalent IS NULL
  ) THEN
    RAISE EXCEPTION 'Withdrawal daily-limit history requires reconciliation'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(sum(w.usd_equivalent), 0)
    INTO v_daily_total
  FROM public.withdrawals w
  WHERE w.user_id = p_user_id
    AND w.created_at >= pg_catalog.now() - interval '24 hours'
    AND lower(coalesce(w.status, '')) IN (
      'pending', 'pending_approval', 'needs_approval', 'queued', 'approved',
      'processing', 'broadcasting', 'broadcasted', 'ambiguous_broadcast',
      'confirmed', 'completed'
    );

  IF v_daily_total + p_usd_equivalent > v_settings.daily_withdrawal_limit_usd THEN
    RAISE EXCEPTION 'Rolling 24-hour withdrawal limit exceeded'
      USING ERRCODE = '22023';
  END IF;

  -- External withdrawals are signed by the platform hot wallet. Customer
  -- wallets are deposit-address records, so they are not a prerequisite for
  -- sending an external payout. Keep wallet_id NULL for this pooled flow.
  v_wallet_chain := NULL;
  v_wallet_id := NULL;

  SELECT coalesce(a.balance, 0), coalesce(a.in_withdrawal, 0)
    INTO v_available, v_in_withdrawal
  FROM public.wallet_assets a
  WHERE a.user_id = p_user_id
    AND a.asset_symbol = v_asset
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Asset balance row is not provisioned; no funds were reserved'
      USING ERRCODE = 'P0002';
  END IF;

  v_total := p_amount + p_fee;
  IF v_total <= 0 OR v_available < v_total THEN
    RAISE EXCEPTION 'Insufficient available balance for amount plus withdrawal fee'
      USING ERRCODE = '22023';
  END IF;

  v_requires_approval := p_usd_equivalent >= v_settings.withdrawal_approval_threshold_usd;
  v_status := CASE WHEN v_requires_approval THEN 'PENDING_APPROVAL' ELSE 'QUEUED' END;

  UPDATE public.wallet_assets
  SET balance = coalesce(balance, 0) - v_total,
      in_withdrawal = coalesce(in_withdrawal, 0) + v_total,
      updated_at = pg_catalog.clock_timestamp()
  WHERE user_id = p_user_id
    AND asset_symbol = v_asset
    AND coalesce(balance, 0) >= v_total
  RETURNING balance, in_withdrawal INTO v_available, v_in_withdrawal;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Could not atomically reserve withdrawal balance'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.withdrawals (
    id, user_id, chain, token_symbol, amount, to_address, status,
    created_at, fee, asset_code, network_code, asset_symbol, network,
    destination_address, network_fee, total_deducted, updated_at,
    requires_admin_approval, approval_reason, network_fee_collected,
    actual_gas_spent, asset, idempotency_key, usd_equivalent
  )
  VALUES (
    v_withdrawal_id, p_user_id, v_network, v_asset, p_amount, p_to_address, v_status,
    pg_catalog.now(), p_fee, v_asset, v_network, v_asset, v_network,
    p_to_address, p_fee, v_total, pg_catalog.now(),
    v_requires_approval,
    CASE WHEN v_requires_approval THEN 'USD amount meets administrator approval threshold' ELSE NULL END,
    0, 0, v_asset, 'w_' || v_withdrawal_id::text, p_usd_equivalent
  );

  INSERT INTO public.onchain_withdrawals (
    id, user_id, network, to_address, amount, fee, asset_symbol,
    status, wallet_id, idempotency_key, metadata, created_at, updated_at
  )
  VALUES (
    v_withdrawal_id, p_user_id, v_network, p_to_address, p_amount, p_fee, v_asset,
    CASE WHEN v_requires_approval THEN 'PENDING_APPROVAL' ELSE 'PENDING' END,
    v_wallet_id, 'w_' || v_withdrawal_id::text,
    pg_catalog.jsonb_build_object(
      'fee', p_fee,
      'total_deducted', v_total,
      'usd_equivalent', p_usd_equivalent,
      'reservation_version', 2
    ),
    pg_catalog.now(), pg_catalog.now()
  );

  INSERT INTO public.ledger_entries (
    user_id, crypto, amount, type, reference_id, balance_after,
    metadata, created_at, asset, chain, status, idempotency_key
  )
  VALUES (
    p_user_id, v_asset, v_total, 'withdrawal_pending', v_withdrawal_id::text,
    v_available,
    pg_catalog.jsonb_build_object(
      'event', 'withdrawal_reserved',
      'withdrawal_id', v_withdrawal_id,
      'principal', p_amount,
      'fee', p_fee,
      'total_deducted', v_total,
      'available_delta', -v_total,
      'in_withdrawal_after', v_in_withdrawal,
      'network', v_network
    ),
    pg_catalog.now(), v_asset, v_network, 'pending',
    'wreserve_' || v_withdrawal_id::text
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'status', v_status,
    'network', v_network,
    'asset', v_asset,
    'amount', p_amount,
    'network_fee', p_fee,
    'total_debited', v_total,
    'usd_equivalent', p_usd_equivalent
  );
END;
$function$;

-- Idempotency boundary: the same account/key/fingerprint can only reserve once.
CREATE OR REPLACE FUNCTION public.request_withdrawal_idempotent(
  p_user_id uuid,
  p_network text,
  p_to_address text,
  p_amount numeric,
  p_fee numeric,
  p_asset text,
  p_usd_equivalent numeric,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request jsonb;
  v_request_hash text;
  v_existing public.financial_idempotency_keys%ROWTYPE;
  v_idempotency_id uuid;
  v_result jsonb;
  v_withdrawal_id uuid;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for withdrawal idempotency';
  END IF;

  IF p_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
    RAISE EXCEPTION 'Invalid withdrawal idempotency key'
      USING ERRCODE = '22023';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'user_id', p_user_id,
    'network', CASE upper(pg_catalog.btrim(p_network))
      WHEN 'ETH' THEN 'ERC20'
      WHEN 'ETHEREUM' THEN 'ERC20'
      WHEN 'TRON' THEN 'TRC20'
      WHEN 'BSC' THEN 'BEP20'
      WHEN 'BINANCE' THEN 'BEP20'
      ELSE upper(pg_catalog.btrim(p_network))
    END,
    'to_address', pg_catalog.btrim(p_to_address),
    'amount', p_amount,
    'asset', upper(pg_catalog.btrim(p_asset))
  );
  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_request::text, 'UTF8')),
    'hex'
  );

  INSERT INTO public.financial_idempotency_keys (
    user_id, idempotency_key, action_type, request_hash,
    response_payload, status, created_at, updated_at
  )
  VALUES (
    p_user_id, p_idempotency_key, 'withdrawal_request', v_request_hash,
    NULL, 'PROCESSING', pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (user_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_idempotency_id;

  IF v_idempotency_id IS NULL THEN
    SELECT *
      INTO v_existing
    FROM public.financial_idempotency_keys
    WHERE user_id = p_user_id
      AND idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Withdrawal idempotency record could not be resolved';
    END IF;

    IF v_existing.action_type IS DISTINCT FROM 'withdrawal_request'
       OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'Idempotency key was used for different withdrawal details'
        USING ERRCODE = '23505';
    END IF;

    IF v_existing.status = 'COMPLETED'
       AND v_existing.response_payload IS NOT NULL THEN
      RETURN v_existing.response_payload ||
        pg_catalog.jsonb_build_object('idempotent_replay', true);
    END IF;

    RAISE EXCEPTION 'Withdrawal request is already in progress'
      USING ERRCODE = '55P03';
  END IF;

  v_result := public.request_withdrawal(
    p_user_id, p_network, p_to_address, p_amount, p_fee, p_asset, p_usd_equivalent
  );

  v_withdrawal_id := (v_result->>'withdrawal_id')::uuid;
  IF v_result IS NULL OR v_result->>'success' IS DISTINCT FROM 'true' OR v_withdrawal_id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal reservation returned an invalid response';
  END IF;

  UPDATE public.onchain_withdrawals
  SET idempotency_key = p_user_id::text || ':' || p_idempotency_key,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal idempotency key could not be persisted';
  END IF;

  UPDATE public.withdrawals
  SET idempotency_key = p_user_id::text || ':' || p_idempotency_key,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Withdrawal mirror idempotency key could not be persisted';
  END IF;

  v_result := v_result || pg_catalog.jsonb_build_object('network_fee', p_fee);

  UPDATE public.financial_idempotency_keys
  SET response_payload = v_result,
      status = 'COMPLETED',
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = v_idempotency_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal idempotency result could not be persisted';
  END IF;

  RETURN v_result || pg_catalog.jsonb_build_object('idempotent_replay', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_withdrawal_idempotency(
  p_user_id uuid,
  p_network text,
  p_to_address text,
  p_amount numeric,
  p_fee numeric,
  p_asset text,
  p_usd_equivalent numeric,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request jsonb;
  v_request_hash text;
  v_existing public.financial_idempotency_keys%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required for withdrawal idempotency lookup';
  END IF;

  IF p_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{16,128}$' THEN
    RAISE EXCEPTION 'Invalid withdrawal idempotency lookup'
      USING ERRCODE = '22023';
  END IF;

  v_request := pg_catalog.jsonb_build_object(
    'user_id', p_user_id,
    'network', CASE upper(pg_catalog.btrim(p_network))
      WHEN 'ETH' THEN 'ERC20'
      WHEN 'ETHEREUM' THEN 'ERC20'
      WHEN 'TRON' THEN 'TRC20'
      WHEN 'BSC' THEN 'BEP20'
      WHEN 'BINANCE' THEN 'BEP20'
      ELSE upper(pg_catalog.btrim(p_network))
    END,
    'to_address', pg_catalog.btrim(p_to_address),
    'amount', p_amount,
    'asset', upper(pg_catalog.btrim(p_asset))
  );
  v_request_hash := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_request::text, 'UTF8')),
    'hex'
  );

  SELECT *
    INTO v_existing
  FROM public.financial_idempotency_keys
  WHERE user_id = p_user_id
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('exists', false);
  END IF;

  IF v_existing.action_type IS DISTINCT FROM 'withdrawal_request'
     OR v_existing.request_hash IS DISTINCT FROM v_request_hash THEN
    RAISE EXCEPTION 'Idempotency key was used for different withdrawal details'
      USING ERRCODE = '23505';
  END IF;

  IF v_existing.status = 'COMPLETED'
     AND v_existing.response_payload IS NOT NULL THEN
    RETURN v_existing.response_payload ||
      pg_catalog.jsonb_build_object('exists', true, 'idempotent_replay', true);
  END IF;

  RAISE EXCEPTION 'Withdrawal request is already in progress'
    USING ERRCODE = '55P03';
END;
$function$;

-- Record accepted broadcasts before any confirmation/settlement work.
CREATE OR REPLACE FUNCTION public.record_onchain_withdrawal_broadcast(
  p_withdrawal_id uuid,
  p_tx_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hash text := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
  v_status text;
  v_existing_hash text;
  v_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to record withdrawal broadcasts'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR v_hash = '' OR length(v_hash) > 160 THEN
    RAISE EXCEPTION 'Invalid withdrawal broadcast payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(status), nullif(lower(btrim(tx_hash)), '')
    INTO v_status, v_existing_hash
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical withdrawal not found';
  END IF;

  IF v_existing_hash IS NOT NULL AND v_existing_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Withdrawal already contains a different transaction hash';
  END IF;

  IF v_status IN ('completed', 'confirmed') THEN
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Completed withdrawal transaction hash conflict';
    END IF;
    RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'status', v_status, 'tx_hash', v_hash);
  END IF;

  IF v_status IN ('failed', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot record a broadcast for a terminal withdrawal';
  END IF;

  IF v_status NOT IN ('processing', 'broadcasted', 'ambiguous_broadcast') THEN
    RAISE EXCEPTION 'Withdrawal is not in a broadcastable state: %', v_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.onchain_withdrawals other
    WHERE lower(btrim(other.tx_hash)) = v_hash
      AND other.id <> p_withdrawal_id
  ) OR EXISTS (
    SELECT 1 FROM public.withdrawals other
    WHERE lower(coalesce(nullif(btrim(other.tx_hash), ''), nullif(btrim(other.txid), ''))) = v_hash
      AND other.id <> p_withdrawal_id
  ) THEN
    RAISE EXCEPTION 'Transaction hash is already assigned to another withdrawal';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'BROADCASTED', tx_hash = v_hash, updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  UPDATE public.withdrawals
  SET status = 'BROADCASTED', tx_hash = v_hash, txid = v_hash,
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
  p_tx_hash text,
  p_error_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_hash text := nullif(lower(pg_catalog.btrim(coalesce(p_tx_hash, ''))), '');
  v_status text;
  v_existing_hash text;
  v_rows integer := 0;
  v_reason text := left(coalesce(nullif(pg_catalog.btrim(p_error_reason), ''), 'Ambiguous broadcast; reconciliation required'), 1000);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to mark ambiguous broadcasts'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR (p_tx_hash IS NOT NULL AND (v_hash IS NULL OR length(v_hash) > 160)) THEN
    RAISE EXCEPTION 'Invalid ambiguous broadcast payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(status), nullif(lower(btrim(tx_hash)), '')
    INTO v_status, v_existing_hash
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical withdrawal not found';
  END IF;

  IF v_status IN ('completed', 'confirmed', 'failed', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot mark a terminal withdrawal as ambiguous';
  END IF;
  IF v_status NOT IN ('processing', 'broadcasted', 'ambiguous_broadcast') THEN
    RAISE EXCEPTION 'Only a claimed or previously broadcast withdrawal can be marked ambiguous';
  END IF;

  IF v_existing_hash IS NOT NULL AND v_hash IS NOT NULL AND v_existing_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Withdrawal already contains a different transaction hash';
  END IF;

  v_hash := coalesce(v_existing_hash, v_hash);

  IF v_hash IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.onchain_withdrawals other
      WHERE lower(btrim(other.tx_hash)) = v_hash AND other.id <> p_withdrawal_id
    ) OR EXISTS (
      SELECT 1 FROM public.withdrawals other
      WHERE lower(coalesce(nullif(btrim(other.tx_hash), ''), nullif(btrim(other.txid), ''))) = v_hash
        AND other.id <> p_withdrawal_id
    )
  ) THEN
    RAISE EXCEPTION 'Transaction hash is already assigned to another withdrawal';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = CASE WHEN lower(status) = 'broadcasted' THEN status ELSE 'AMBIGUOUS_BROADCAST' END,
      tx_hash = coalesce(v_hash, tx_hash),
      error_message = v_reason,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;

  UPDATE public.withdrawals
  SET status = CASE WHEN lower(status) = 'broadcasted' THEN status ELSE 'AMBIGUOUS_BROADCAST' END,
      tx_hash = coalesce(v_hash, tx_hash),
      txid = coalesce(v_hash, txid),
      broadcast_error = v_reason,
      broadcasted_at = CASE WHEN v_hash IS NOT NULL THEN coalesce(broadcasted_at, pg_catalog.clock_timestamp()) ELSE broadcasted_at END,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Withdrawal mirror ambiguous-broadcast update failed';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', CASE WHEN v_status = 'broadcasted' THEN 'BROADCASTED' ELSE 'AMBIGUOUS_BROADCAST' END,
    'tx_hash', v_hash
  );
END;
$function$;

-- Final settlement uses the actual ledger_entries layout found in production.
CREATE OR REPLACE FUNCTION public.complete_onchain_withdrawal(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_actual_gas_amount numeric DEFAULT 0,
  p_gas_asset text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_w public.onchain_withdrawals%ROWTYPE;
  v_status text;
  v_hash text := lower(pg_catalog.btrim(coalesce(p_tx_hash, '')));
  v_fee numeric(36,18);
  v_total numeric(36,18);
  v_gas_asset text;
  v_balance numeric(36,18);
  v_locked numeric(36,18);
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to complete withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR v_hash = '' OR length(v_hash) > 160
     OR coalesce(p_actual_gas_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Invalid withdrawal completion payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_w
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
  IF v_status IN ('completed', 'confirmed') THEN
    IF lower(coalesce(v_w.tx_hash, '')) IS DISTINCT FROM v_hash THEN
      RAISE EXCEPTION 'Completed withdrawal transaction hash conflict';
    END IF;

    v_fee := coalesce((v_w.metadata->>'fee')::numeric, v_w.fee, 0);
    IF v_fee < 0 THEN
      RAISE EXCEPTION 'Completed withdrawal fee metadata is invalid';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.withdrawals mirror WHERE mirror.id = p_withdrawal_id) THEN
      RAISE EXCEPTION 'Completed withdrawal mirror is missing';
    END IF;

    IF v_fee > 0 THEN
      PERFORM public.record_platform_ledger_entry(
        p_entry_type := 'withdrawal_fee_collected',
        p_asset_code := v_w.asset_symbol,
        p_amount := v_fee,
        p_direction := 'CREDIT',
        p_related_user_id := v_w.user_id,
        p_ref_table := 'onchain_withdrawals',
        p_ref_id := p_withdrawal_id::text,
        p_network_code := v_w.network,
        p_tx_hash := v_hash,
        p_idempotency_key := 'pf_fee_col_' || p_withdrawal_id::text,
        p_metadata := pg_catalog.jsonb_build_object('principal', v_w.amount, 'total_deducted', v_w.amount + v_fee, 'backfilled', true)
      );
    END IF;

    IF coalesce(p_actual_gas_amount, 0) > 0 THEN
      v_gas_asset := upper(pg_catalog.btrim(coalesce(p_gas_asset, '')));
      IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.code = v_gas_asset) THEN
        RAISE EXCEPTION 'Unregistered gas asset %', v_gas_asset;
      END IF;
      IF (v_w.network = 'TRC20' AND v_gas_asset <> 'TRX')
         OR (v_w.network = 'ERC20' AND v_gas_asset <> 'ETH')
         OR (v_w.network = 'BEP20' AND v_gas_asset <> 'BNB') THEN
        RAISE EXCEPTION 'Gas asset does not match completed withdrawal network';
      END IF;
      PERFORM public.record_platform_ledger_entry(
        p_entry_type := 'network_gas_expense',
        p_asset_code := v_gas_asset,
        p_amount := p_actual_gas_amount,
        p_direction := 'DEBIT',
        p_related_user_id := v_w.user_id,
        p_ref_table := 'onchain_withdrawals',
        p_ref_id := p_withdrawal_id::text,
        p_network_code := v_w.network,
        p_tx_hash := v_hash,
        p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::text,
        p_metadata := pg_catalog.jsonb_build_object('gas_asset', v_gas_asset, 'gas_amount', p_actual_gas_amount, 'backfilled', true)
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'COMPLETED', 'tx_hash', v_hash
    );
  END IF;

  IF v_status NOT IN ('broadcasted', 'processing', 'ambiguous_broadcast') THEN
    RAISE EXCEPTION 'Cannot complete withdrawal in state %', v_w.status;
  END IF;

  IF lower(coalesce(v_w.tx_hash, '')) IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION 'Withdrawal does not contain the exact recorded broadcast hash';
  END IF;

  v_fee := coalesce((v_w.metadata->>'fee')::numeric, v_w.fee, 0);
  v_total := v_w.amount + v_fee;

  IF v_w.amount IS NULL OR v_w.amount <= 0 OR v_fee < 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Withdrawal principal or fee is invalid';
  END IF;

  IF v_w.metadata ? 'total_deducted'
     AND (v_w.metadata->>'total_deducted')::numeric IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'Withdrawal total_deducted metadata mismatch';
  END IF;

  IF coalesce(p_actual_gas_amount, 0) > 0 THEN
    IF p_gas_asset IS NULL OR pg_catalog.btrim(p_gas_asset) = '' THEN
      RAISE EXCEPTION 'Gas asset is required when measured gas is positive';
    END IF;
    v_gas_asset := upper(pg_catalog.btrim(p_gas_asset));

    IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.code = v_gas_asset) THEN
      RAISE EXCEPTION 'Unregistered gas asset %', v_gas_asset;
    END IF;

    IF (v_w.network = 'TRC20' AND v_gas_asset <> 'TRX')
       OR (v_w.network = 'ERC20' AND v_gas_asset <> 'ETH')
       OR (v_w.network = 'BEP20' AND v_gas_asset <> 'BNB') THEN
      RAISE EXCEPTION 'Gas asset does not match withdrawal network';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_hash, 0));

  IF EXISTS (
    SELECT 1 FROM public.onchain_withdrawals other
    WHERE lower(btrim(other.tx_hash)) = v_hash
      AND other.id <> p_withdrawal_id
  ) OR EXISTS (
    SELECT 1 FROM public.withdrawals other
    WHERE lower(coalesce(nullif(btrim(other.tx_hash), ''), nullif(btrim(other.txid), ''))) = v_hash
      AND other.id <> p_withdrawal_id
  ) THEN
    RAISE EXCEPTION 'Transaction hash is already linked to another withdrawal';
  END IF;

  SELECT coalesce(a.balance, 0), coalesce(a.in_withdrawal, 0)
    INTO v_balance, v_locked
  FROM public.wallet_assets a
  WHERE a.user_id = v_w.user_id
    AND a.asset_symbol = v_w.asset_symbol
  FOR UPDATE;

  IF NOT FOUND OR v_locked < v_total THEN
    RAISE EXCEPTION 'Reserved withdrawal liability is missing or insufficient';
  END IF;

  UPDATE public.wallet_assets
  SET in_withdrawal = coalesce(in_withdrawal, 0) - v_total,
      updated_at = pg_catalog.clock_timestamp()
  WHERE user_id = v_w.user_id
    AND asset_symbol = v_w.asset_symbol
    AND coalesce(in_withdrawal, 0) >= v_total;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Could not release the completed withdrawal reservation';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'COMPLETED', updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Canonical withdrawal completion update failed'; END IF;

  UPDATE public.withdrawals
  SET status = 'completed',
      tx_hash = v_hash,
      txid = v_hash,
      network_fee_collected = coalesce(network_fee_collected, 0) + v_fee,
      actual_gas_spent = coalesce(actual_gas_spent, 0) + coalesce(p_actual_gas_amount, 0),
      broadcasted_at = coalesce(broadcasted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Withdrawal mirror completion update failed';
  END IF;

  INSERT INTO public.ledger_entries (
    user_id, crypto, amount, type, reference_id, balance_after,
    metadata, created_at, asset, chain, status, idempotency_key
  )
  VALUES (
    v_w.user_id, v_w.asset_symbol, v_total, 'withdrawal',
    p_withdrawal_id::text, v_balance,
    pg_catalog.jsonb_build_object(
      'event', 'withdrawal_completed',
      'withdrawal_id', p_withdrawal_id,
      'principal', v_w.amount,
      'fee', v_fee,
      'total_deducted', v_total,
      'tx_hash', v_hash,
      'actual_gas_amount', coalesce(p_actual_gas_amount, 0),
      'gas_asset', v_gas_asset
    ),
    pg_catalog.now(), v_w.asset_symbol, v_w.network, 'completed',
    'wcomplete_' || p_withdrawal_id::text
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  IF v_fee > 0 THEN
    PERFORM public.record_platform_ledger_entry(
      p_entry_type := 'withdrawal_fee_collected',
      p_asset_code := v_w.asset_symbol,
      p_amount := v_fee,
      p_direction := 'CREDIT',
      p_related_user_id := v_w.user_id,
      p_ref_table := 'onchain_withdrawals',
      p_ref_id := p_withdrawal_id::text,
      p_network_code := v_w.network,
      p_tx_hash := v_hash,
      p_idempotency_key := 'pf_fee_col_' || p_withdrawal_id::text,
      p_metadata := pg_catalog.jsonb_build_object('principal', v_w.amount, 'total_deducted', v_total)
    );
  END IF;

  IF coalesce(p_actual_gas_amount, 0) > 0 THEN
    PERFORM public.record_platform_ledger_entry(
      p_entry_type := 'network_gas_expense',
      p_asset_code := v_gas_asset,
      p_amount := p_actual_gas_amount,
      p_direction := 'DEBIT',
      p_related_user_id := v_w.user_id,
      p_ref_table := 'onchain_withdrawals',
      p_ref_id := p_withdrawal_id::text,
      p_network_code := v_w.network,
      p_tx_hash := v_hash,
      p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::text,
      p_metadata := pg_catalog.jsonb_build_object('gas_asset', v_gas_asset, 'gas_amount', p_actual_gas_amount)
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', 'COMPLETED', 'tx_hash', v_hash,
    'actual_gas_amount', coalesce(p_actual_gas_amount, 0),
    'gas_asset', v_gas_asset
  );
END;
$function$;

-- Only proven pre-broadcast failures or confirmed on-chain reverts may refund.
-- An unknown/ambiguous send is kept reserved for operator reconciliation.
CREATE OR REPLACE FUNCTION public.process_failed_withdrawal(
  p_withdrawal_id uuid,
  p_error_reason text,
  p_actual_gas_amount numeric DEFAULT 0,
  p_gas_asset text DEFAULT NULL,
  p_is_verified_unbroadcast boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_w public.onchain_withdrawals%ROWTYPE;
  v_status text;
  v_hash text;
  v_fee numeric(36,18);
  v_total numeric(36,18);
  v_reason text := left(coalesce(nullif(pg_catalog.btrim(p_error_reason), ''), 'Withdrawal processing failure'), 1000);
  v_gas_asset text;
  v_balance numeric(36,18);
  v_locked numeric(36,18);
  v_rows integer;
  v_refund_recorded boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to refund withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR coalesce(p_actual_gas_amount, 0) < 0 THEN
    RAISE EXCEPTION 'Invalid withdrawal failure payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_w
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  v_status := lower(coalesce(v_w.status, ''));
  v_hash := nullif(lower(pg_catalog.btrim(coalesce(v_w.tx_hash, ''))), '');
  v_fee := coalesce((v_w.metadata->>'fee')::numeric, v_w.fee, 0);
  v_total := v_w.amount + v_fee;

  IF v_w.amount IS NULL OR v_w.amount <= 0 OR v_fee < 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Withdrawal principal or fee is invalid';
  END IF;
  IF v_w.metadata ? 'total_deducted'
     AND (v_w.metadata->>'total_deducted')::numeric IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'Withdrawal total_deducted metadata mismatch; refund requires reconciliation';
  END IF;

  IF v_status = 'failed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ledger_entries le
      WHERE le.reference_id = p_withdrawal_id::text
        AND le.type = 'withdrawal'
        AND (
          le.idempotency_key = 'wrefund_' || p_withdrawal_id::text
          OR le.metadata->>'event' IN ('withdrawal_refunded', 'withdrawal_admin_rejected')
        )
    ) INTO v_refund_recorded;

    IF NOT v_refund_recorded THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', false, 'code', 'REFUND_RECONCILIATION_REQUIRED',
        'withdrawal_id', p_withdrawal_id, 'status', 'FAILED',
        'message', 'Failed state exists without a verifiable refund ledger entry'
      );
    END IF;

    IF v_hash IS NOT NULL AND coalesce(p_is_verified_unbroadcast, false)
       AND coalesce(p_actual_gas_amount, 0) > 0 THEN
      v_gas_asset := upper(pg_catalog.btrim(coalesce(p_gas_asset, '')));
      IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.code = v_gas_asset)
         OR (v_w.network = 'TRC20' AND v_gas_asset <> 'TRX')
         OR (v_w.network = 'ERC20' AND v_gas_asset <> 'ETH')
         OR (v_w.network = 'BEP20' AND v_gas_asset <> 'BNB') THEN
        RAISE EXCEPTION 'Gas asset does not match failed withdrawal network';
      END IF;
      PERFORM public.record_platform_ledger_entry(
        p_entry_type := 'network_gas_expense',
        p_asset_code := v_gas_asset,
        p_amount := p_actual_gas_amount,
        p_direction := 'DEBIT',
        p_related_user_id := v_w.user_id,
        p_ref_table := 'onchain_withdrawals',
        p_ref_id := p_withdrawal_id::text,
        p_network_code := v_w.network,
        p_tx_hash := v_hash,
        p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::text,
        p_metadata := pg_catalog.jsonb_build_object('gas_asset', v_gas_asset, 'gas_amount', p_actual_gas_amount)
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object('success', true, 'idempotent', true, 'withdrawal_id', p_withdrawal_id, 'status', 'FAILED');
  END IF;

  IF v_status IN ('completed', 'confirmed', 'cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot refund withdrawal in terminal state %', v_w.status;
  END IF;

  IF v_hash IS NULL THEN
    IF v_status = 'ambiguous_broadcast' OR v_status = 'broadcasted'
       OR NOT coalesce(p_is_verified_unbroadcast, false)
       OR coalesce(p_actual_gas_amount, 0) <> 0
       OR v_status NOT IN ('pending', 'processing', 'needs_approval', 'pending_approval') THEN
      IF v_status IN ('processing', 'ambiguous_broadcast', 'broadcasted') THEN
        UPDATE public.onchain_withdrawals
        SET status = 'AMBIGUOUS_BROADCAST', error_message = v_reason,
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = p_withdrawal_id;
        UPDATE public.withdrawals
        SET status = 'AMBIGUOUS_BROADCAST', broadcast_error = v_reason,
            updated_at = pg_catalog.clock_timestamp()
        WHERE id = p_withdrawal_id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows <> 1 THEN
          RAISE EXCEPTION 'Withdrawal mirror ambiguous-failure update failed';
        END IF;
      END IF;
      RETURN pg_catalog.jsonb_build_object(
        'success', false, 'code', 'AMBIGUOUS_BROADCAST_REFUND_BLOCKED',
        'withdrawal_id', p_withdrawal_id, 'status', 'AMBIGUOUS_BROADCAST'
      );
    END IF;
  ELSE
    -- A recorded hash can only be refunded after the confirmation worker has
    -- established a final on-chain revert and supplied a measured positive burn.
    IF NOT coalesce(p_is_verified_unbroadcast, false)
       OR coalesce(p_actual_gas_amount, 0) <= 0
       OR v_status NOT IN ('broadcasted', 'processing', 'ambiguous_broadcast') THEN
      RAISE EXCEPTION 'Recorded broadcast cannot be refunded without confirmed revert and measured gas';
    END IF;

    v_gas_asset := upper(pg_catalog.btrim(coalesce(p_gas_asset, '')));
    IF NOT EXISTS (SELECT 1 FROM public.assets a WHERE a.code = v_gas_asset) THEN
      RAISE EXCEPTION 'Unregistered gas asset %', v_gas_asset;
    END IF;

    IF (v_w.network = 'TRC20' AND v_gas_asset <> 'TRX')
       OR (v_w.network = 'ERC20' AND v_gas_asset <> 'ETH')
       OR (v_w.network = 'BEP20' AND v_gas_asset <> 'BNB') THEN
      RAISE EXCEPTION 'Gas asset does not match withdrawal network';
    END IF;
  END IF;

  SELECT coalesce(a.balance, 0), coalesce(a.in_withdrawal, 0)
    INTO v_balance, v_locked
  FROM public.wallet_assets a
  WHERE a.user_id = v_w.user_id
    AND a.asset_symbol = v_w.asset_symbol
  FOR UPDATE;

  IF NOT FOUND OR v_locked < v_total THEN
    RAISE EXCEPTION 'Reserved withdrawal liability is missing or insufficient for refund';
  END IF;

  UPDATE public.wallet_assets
  SET balance = coalesce(balance, 0) + v_total,
      in_withdrawal = coalesce(in_withdrawal, 0) - v_total,
      updated_at = pg_catalog.clock_timestamp()
  WHERE user_id = v_w.user_id
    AND asset_symbol = v_w.asset_symbol
    AND coalesce(in_withdrawal, 0) >= v_total
  RETURNING balance, in_withdrawal INTO v_balance, v_locked;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Could not atomically refund withdrawal liability';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'FAILED', error_message = v_reason, updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Canonical withdrawal failure update failed'; END IF;

  UPDATE public.withdrawals
  SET status = 'failed',
      tx_hash = coalesce(tx_hash, v_hash),
      txid = coalesce(txid, v_hash),
      broadcast_error = v_reason,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Withdrawal mirror failure update failed';
  END IF;

  INSERT INTO public.ledger_entries (
    user_id, crypto, amount, type, reference_id, balance_after,
    metadata, created_at, asset, chain, status, idempotency_key
  )
  VALUES (
    v_w.user_id, v_w.asset_symbol, v_total, 'withdrawal',
    p_withdrawal_id::text, v_balance,
    pg_catalog.jsonb_build_object(
      'event', 'withdrawal_refunded',
      'withdrawal_id', p_withdrawal_id,
      'principal', v_w.amount,
      'fee_refunded', v_fee,
      'total_refunded', v_total,
      'tx_hash', v_hash,
      'reason', v_reason,
      'actual_gas_amount', coalesce(p_actual_gas_amount, 0),
      'gas_asset', v_gas_asset
    ),
    pg_catalog.now(), v_w.asset_symbol, v_w.network, 'failed',
    'wrefund_' || p_withdrawal_id::text
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  IF v_hash IS NOT NULL AND coalesce(p_actual_gas_amount, 0) > 0 THEN
    PERFORM public.record_platform_ledger_entry(
      p_entry_type := 'network_gas_expense',
      p_asset_code := v_gas_asset,
      p_amount := p_actual_gas_amount,
      p_direction := 'DEBIT',
      p_related_user_id := v_w.user_id,
      p_ref_table := 'onchain_withdrawals',
      p_ref_id := p_withdrawal_id::text,
      p_network_code := v_w.network,
      p_tx_hash := v_hash,
      p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::text,
      p_metadata := pg_catalog.jsonb_build_object('gas_asset', v_gas_asset, 'gas_amount', p_actual_gas_amount, 'stage', 'confirmed_revert')
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', 'FAILED', 'refunded_amount', v_total,
    'actual_gas_amount', coalesce(p_actual_gas_amount, 0),
    'gas_asset', v_gas_asset
  );
END;
$function$;

-- Align approval transitions with the actual columns: approval metadata lives
-- on onchain_withdrawals, not on the legacy withdrawals mirror.
CREATE OR REPLACE FUNCTION public.approve_withdrawal(
  p_withdrawal_id uuid,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_legacy public.withdrawals%ROWTYPE;
  v_onchain public.onchain_withdrawals%ROWTYPE;
  v_is_admin boolean := false;
  v_rows integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to approve withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal and administrator identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a WHERE a.user_id = p_admin_id
    UNION
    SELECT 1 FROM public.profiles p WHERE p.id = p_admin_id AND (p.role = 'admin' OR p.is_admin = true)
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Caller is not an authorized administrator'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_legacy
  FROM public.withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal mirror not found';
  END IF;

  SELECT * INTO v_onchain
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found';
  END IF;

  IF lower(v_legacy.status) = 'queued' AND v_onchain.status = 'PENDING' THEN
    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'QUEUED'
    );
  END IF;

  IF lower(v_legacy.status) NOT IN ('pending_approval', 'pending')
     OR v_onchain.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Withdrawal is not awaiting approval';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'PENDING', approved_by = p_admin_id,
      approved_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Canonical withdrawal approval update failed'; END IF;

  UPDATE public.withdrawals
  SET status = 'QUEUED', updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Withdrawal mirror approval update failed'; END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, details, created_at
  ) VALUES (
    p_admin_id, 'admin_approver@paxones.com', 'ADMIN_APPROVED_WITHDRAWAL',
    pg_catalog.jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'amount', v_legacy.amount,
      'asset', v_legacy.asset_symbol,
      'network', v_legacy.network
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', 'QUEUED', 'message', 'Withdrawal approved and queued for broadcast'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.check_withdrawal_idempotency(uuid,text,text,numeric,numeric,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_onchain_withdrawal_broadcast(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_withdrawal_ambiguous_broadcast(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_onchain_withdrawal(uuid,text,numeric,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_failed_withdrawal(uuid,text,numeric,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid,uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_withdrawal_idempotency(uuid,text,text,numeric,numeric,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_onchain_withdrawal_broadcast(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_ambiguous_broadcast(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_onchain_withdrawal(uuid,text,numeric,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(uuid,text,numeric,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid,uuid) TO service_role;


-- Administrator rejection is a distinct pre-broadcast transition. It never
-- refunds PROCESSING/BROADCASTED/AMBIGUOUS withdrawals and updates both ledgers atomically.
CREATE OR REPLACE FUNCTION public.reject_withdrawal_pending_approval(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_legacy public.withdrawals%ROWTYPE;
  v_onchain public.onchain_withdrawals%ROWTYPE;
  v_admin boolean := false;
  v_fee numeric(36,18);
  v_total numeric(36,18);
  v_balance numeric(36,18);
  v_locked numeric(36,18);
  v_reason text := left(coalesce(nullif(pg_catalog.btrim(p_reason), ''), 'Rejected by administrator'), 1000);
  v_rows integer;
  v_refund_recorded boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to reject withdrawals'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal and administrator identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.app_admins a WHERE a.user_id = p_admin_id
    UNION
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_admin_id AND (p.role = 'admin' OR p.is_admin = true)
  ) INTO v_admin;

  IF NOT v_admin THEN
    RAISE EXCEPTION 'Caller is not an authorized administrator'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_legacy
  FROM public.withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal mirror not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_onchain
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical on-chain withdrawal not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(coalesce(v_legacy.status, '')) = 'rejected'
     AND v_onchain.status = 'FAILED'
     AND nullif(btrim(coalesce(v_onchain.tx_hash, '')), '') IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ledger_entries le
      WHERE le.reference_id = p_withdrawal_id::text
        AND le.type = 'withdrawal'
        AND (
          le.idempotency_key = 'wreject_' || p_withdrawal_id::text
          OR le.metadata->>'event' = 'withdrawal_admin_rejected'
        )
    ) INTO v_refund_recorded;

    IF NOT v_refund_recorded THEN
      RAISE EXCEPTION 'Rejected withdrawal is missing its refund ledger entry; reconciliation is required';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', true, 'idempotent', true,
      'withdrawal_id', p_withdrawal_id, 'status', 'REJECTED'
    );
  END IF;

  IF lower(coalesce(v_legacy.status, '')) NOT IN ('pending_approval', 'queued', 'pending')
     OR v_onchain.status NOT IN ('PENDING_APPROVAL', 'PENDING')
     OR nullif(btrim(coalesce(v_onchain.tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Only a not-yet-broadcast pending withdrawal can be rejected; current states are % / %',
      v_legacy.status, v_onchain.status
      USING ERRCODE = '55000';
  END IF;

  v_fee := coalesce((v_onchain.metadata->>'fee')::numeric, v_onchain.fee, 0);
  v_total := v_onchain.amount + v_fee;

  IF v_onchain.amount IS NULL OR v_onchain.amount <= 0 OR v_fee < 0 OR v_total <= 0 THEN
    RAISE EXCEPTION 'Withdrawal principal or fee is invalid';
  END IF;

  IF v_onchain.metadata ? 'total_deducted'
     AND (v_onchain.metadata->>'total_deducted')::numeric IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'Withdrawal total_deducted metadata mismatch';
  END IF;

  SELECT coalesce(a.balance, 0), coalesce(a.in_withdrawal, 0)
    INTO v_balance, v_locked
  FROM public.wallet_assets a
  WHERE a.user_id = v_onchain.user_id
    AND a.asset_symbol = v_onchain.asset_symbol
  FOR UPDATE;

  IF NOT FOUND OR v_locked < v_total THEN
    RAISE EXCEPTION 'Reserved withdrawal liability is missing or insufficient for administrative rejection';
  END IF;

  UPDATE public.wallet_assets
  SET balance = coalesce(balance, 0) + v_total,
      in_withdrawal = coalesce(in_withdrawal, 0) - v_total,
      updated_at = pg_catalog.clock_timestamp()
  WHERE user_id = v_onchain.user_id
    AND asset_symbol = v_onchain.asset_symbol
    AND coalesce(in_withdrawal, 0) >= v_total
  RETURNING balance, in_withdrawal INTO v_balance, v_locked;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Could not atomically return the pending withdrawal reservation';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'FAILED',
      rejection_reason = v_reason,
      error_message = v_reason,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Canonical withdrawal rejection update failed'; END IF;

  UPDATE public.withdrawals
  SET status = 'rejected',
      rejected_reason = v_reason,
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Withdrawal mirror rejection update failed'; END IF;

  INSERT INTO public.ledger_entries (
    user_id, crypto, amount, type, reference_id, balance_after,
    metadata, created_at, asset, chain, status, idempotency_key
  )
  VALUES (
    v_onchain.user_id, v_onchain.asset_symbol, v_total, 'withdrawal',
    p_withdrawal_id::text, v_balance,
    pg_catalog.jsonb_build_object(
      'event', 'withdrawal_admin_rejected',
      'withdrawal_id', p_withdrawal_id,
      'principal_refunded', v_onchain.amount,
      'fee_refunded', v_fee,
      'total_refunded', v_total,
      'reason', v_reason,
      'admin_id', p_admin_id
    ),
    pg_catalog.now(), v_onchain.asset_symbol, v_onchain.network, 'rejected',
    'wreject_' || p_withdrawal_id::text
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, details, created_at
  )
  VALUES (
    p_admin_id,
    'admin@paxones.com',
    'ADMIN_REJECTED_WITHDRAWAL',
    pg_catalog.jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_onchain.user_id,
      'asset', v_onchain.asset_symbol,
      'network', v_onchain.network,
      'refunded_amount', v_total,
      'reason', v_reason
    ),
    pg_catalog.now()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'status', 'REJECTED',
    'refunded_amount', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_withdrawal_pending_approval(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_pending_approval(uuid,uuid,text) TO service_role;


-- Queue claim is a single atomic state transition across canonical and mirror
-- records. It never claims an unsupported network/asset combination.
CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(
  p_limit integer DEFAULT 10
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

  WITH candidates AS (
    SELECT w.id
    FROM public.onchain_withdrawals w
    WHERE w.status = 'PENDING'
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
    SET status = 'PROCESSING',
        updated_at = pg_catalog.clock_timestamp()
    FROM candidates c
    WHERE w.id = c.id
      AND w.status = 'PENDING'
    RETURNING w.id
  )
  SELECT coalesce(pg_catalog.array_agg(id), ARRAY[]::uuid[])
    INTO v_ids
  FROM claimed;

  IF pg_catalog.cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.withdrawals mirror
  SET status = 'processing',
      updated_at = pg_catalog.clock_timestamp()
  WHERE mirror.id = ANY(v_ids)
    AND lower(coalesce(mirror.status, '')) IN ('queued', 'pending', 'approved', 'processing');

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

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer) TO service_role;


-- Retire the older custodial cancel/refund helper that did not check a tx hash,
-- did not update the legacy mirror, and wrote a non-idempotent ledger row.
CREATE OR REPLACE FUNCTION public.refund_custodial_withdrawal(
  p_withdrawal_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_w public.onchain_withdrawals%ROWTYPE;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to refund custodial withdrawals'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_w
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF lower(v_w.status) IN ('failed', 'cancelled') THEN
    IF EXISTS (
      SELECT 1 FROM public.ledger_entries le
      WHERE le.reference_id = p_withdrawal_id::text
        AND le.type = 'withdrawal'
        AND le.idempotency_key IN ('wrefund_' || p_withdrawal_id::text, 'wreject_' || p_withdrawal_id::text)
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true, 'idempotent', true,
        'withdrawal_id', p_withdrawal_id, 'status', v_w.status
      );
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'success', false, 'code', 'REFUND_RECONCILIATION_REQUIRED',
      'withdrawal_id', p_withdrawal_id,
      'message', 'Terminal withdrawal state has no verifiable refund ledger entry'
    );
  END IF;

  IF lower(v_w.status) NOT IN ('pending', 'needs_approval', 'pending_approval')
     OR nullif(pg_catalog.btrim(coalesce(v_w.tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Only an unbroadcast pending withdrawal can be cancelled or refunded';
  END IF;

  v_result := public.process_failed_withdrawal(
    p_withdrawal_id,
    coalesce(p_reason, 'Custodial withdrawal cancelled before broadcast'),
    0,
    NULL,
    true
  );

  IF v_result IS NULL OR v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Atomic custodial withdrawal refund was not confirmed';
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_custodial_withdrawal(
  p_withdrawal_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_w public.onchain_withdrawals%ROWTYPE;
  v_result jsonb;
  v_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to cancel custodial withdrawals'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_w
  FROM public.onchain_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  IF v_w.status = 'CANCELLED' THEN
    IF EXISTS (
      SELECT 1 FROM public.ledger_entries le
      WHERE le.reference_id = p_withdrawal_id::text
        AND le.type = 'withdrawal'
        AND le.idempotency_key = 'wrefund_' || p_withdrawal_id::text
    ) THEN
      RETURN pg_catalog.jsonb_build_object(
        'success', true, 'idempotent', true,
        'withdrawal_id', p_withdrawal_id, 'status', 'CANCELLED'
      );
    END IF;
    RAISE EXCEPTION 'Cancelled withdrawal is missing its refund ledger entry; reconciliation is required';
  END IF;

  IF v_w.status NOT IN ('PENDING', 'NEEDS_APPROVAL', 'PENDING_APPROVAL')
     OR nullif(pg_catalog.btrim(coalesce(v_w.tx_hash, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal cannot be cancelled after processing/broadcast has started';
  END IF;

  v_result := public.refund_custodial_withdrawal(
    p_withdrawal_id,
    coalesce(p_reason, 'Custodial withdrawal cancelled before broadcast')
  );

  IF v_result IS NULL OR v_result->>'success' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Atomic custodial withdrawal cancellation was not confirmed';
  END IF;

  UPDATE public.onchain_withdrawals
  SET status = 'CANCELLED',
      error_message = left(coalesce(p_reason, 'Custodial withdrawal cancelled before broadcast'), 1000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id
    AND status = 'FAILED';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Canonical custodial cancellation update failed'; END IF;

  UPDATE public.withdrawals
  SET status = 'cancelled',
      rejected_reason = left(coalesce(p_reason, 'Custodial withdrawal cancelled before broadcast'), 1000),
      updated_at = pg_catalog.clock_timestamp()
  WHERE id = p_withdrawal_id
    AND lower(status) = 'failed';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Withdrawal mirror custodial cancellation update failed'; END IF;

  RETURN pg_catalog.jsonb_build_object(
    'success', true, 'withdrawal_id', p_withdrawal_id,
    'status', 'CANCELLED', 'refunded_amount', v_result->'refunded_amount'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refund_custodial_withdrawal(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_custodial_withdrawal(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_custodial_withdrawal(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_custodial_withdrawal(uuid,text) TO service_role;

-- Keep the obsolete legacy admin rejection RPC inaccessible; admin review now
-- uses reject_withdrawal_pending_approval and the wallet_assets ledger.
REVOKE ALL ON FUNCTION public.admin_reject_queued_withdrawal(text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;