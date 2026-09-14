-- ==============================================================================
-- P2P EXCHANGE & HD WALLET PRODUCTION FIX MIGRATION & FUNCTIONS
-- ==============================================================================

-- 1. SANITIZE AND COMPUTE TRADE FUNCTION (Enforces non-zero rates & strict math)
CREATE OR REPLACE FUNCTION public.sanitize_and_compute_trade(
  p_crypto_amount NUMERIC,
  p_rate NUMERIC,
  p_fiat_amount NUMERIC
) RETURNS TABLE (
  computed_crypto NUMERIC,
  computed_rate NUMERIC,
  computed_fiat NUMERIC,
  escrow_fee NUMERIC
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_crypto NUMERIC;
  v_rate NUMERIC;
  v_fiat NUMERIC;
  v_fee NUMERIC;
BEGIN
  v_crypto := COALESCE(p_crypto_amount, 0);
  v_rate := COALESCE(p_rate, 0);
  v_fiat := COALESCE(p_fiat_amount, 0);

  -- Fallback rate check (Never allow 0 rate)
  IF v_rate <= 0 THEN
    v_rate := CASE 
      WHEN v_crypto > 0 AND v_fiat > 0 THEN v_fiat / v_crypto 
      ELSE 1.0 
    END;
  END IF;

  -- Ensure consistent calculation
  IF v_crypto > 0 AND v_fiat <= 0 THEN
    v_fiat := v_crypto * v_rate;
  ELSIF v_fiat > 0 AND v_crypto <= 0 THEN
    v_crypto := v_fiat / v_rate;
  END IF;

  -- 1.5% escrow fee on crypto amount
  v_fee := v_crypto * 0.015;

  RETURN QUERY SELECT v_crypto, v_rate, v_fiat, v_fee;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sanitize_and_compute_trade FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sanitize_and_compute_trade TO authenticated, service_role;


-- 2. INITIATE P2P TRADE RPC (Atomic creation & escrow lock)
CREATE OR REPLACE FUNCTION public.initiate_p2p_trade(
  p_ad_id UUID,
  p_buyer_id UUID,
  p_seller_id UUID,
  p_crypto_amount NUMERIC,
  p_crypto_symbol TEXT,
  p_rate NUMERIC,
  p_fiat_amount NUMERIC,
  p_fiat_currency TEXT,
  p_payment_method TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_computed RECORD;
  v_trade_id UUID;
  v_seller_balance NUMERIC;
BEGIN
  -- Validate user authentication
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Unauthorized trade initiation';
  END IF;

  -- Compute valid amounts
  SELECT * INTO v_computed FROM public.sanitize_and_compute_trade(p_crypto_amount, p_rate, p_fiat_amount);

  IF v_computed.computed_crypto <= 0 OR v_computed.computed_fiat <= 0 OR v_computed.computed_rate <= 0 THEN
    RAISE EXCEPTION 'Invalid trade calculation amounts';
  END IF;

  -- Check seller available balance
  SELECT available_balance INTO v_seller_balance
  FROM public.balances
  WHERE user_id = p_seller_id AND asset = UPPER(p_crypto_symbol)
  FOR UPDATE;

  IF v_seller_balance IS NULL OR v_seller_balance < (v_computed.computed_crypto + v_computed.escrow_fee) THEN
    RAISE EXCEPTION 'Seller has insufficient balance in escrow';
  END IF;

  -- Deduct from seller available balance and lock in escrow
  UPDATE public.balances
  SET available_balance = available_balance - (v_computed.computed_crypto + v_computed.escrow_fee),
      locked_balance = COALESCE(locked_balance, 0) + (v_computed.computed_crypto + v_computed.escrow_fee),
      updated_at = NOW()
  WHERE user_id = p_seller_id AND asset = UPPER(p_crypto_symbol);

  -- Insert Trade Record
  INSERT INTO public.trades (
    ad_id,
    buyer_id,
    seller_id,
    crypto,
    crypto_amount,
    amount,
    escrow_fee,
    fiat_currency,
    fiat_amount,
    total_fiat,
    rate,
    price,
    payment_method,
    status,
    payment_window_minutes,
    created_at,
    expires_at
  ) VALUES (
    p_ad_id,
    p_buyer_id,
    p_seller_id,
    UPPER(p_crypto_symbol),
    v_computed.computed_crypto,
    v_computed.computed_crypto,
    v_computed.escrow_fee,
    UPPER(p_fiat_currency),
    v_computed.computed_fiat,
    v_computed.computed_fiat,
    v_computed.computed_rate,
    v_computed.computed_rate,
    p_payment_method,
    'pending',
    15,
    NOW(),
    NOW() + INTERVAL '15 minutes'
  ) RETURNING id INTO v_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', v_trade_id,
    'crypto_amount', v_computed.computed_crypto,
    'fiat_amount', v_computed.computed_fiat,
    'rate', v_computed.computed_rate
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.initiate_p2p_trade FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade TO authenticated, service_role;


-- 3. AUTOMATIC TRADE EXPIRATION & ESCROW RELEASE FUNCTION
CREATE OR REPLACE FUNCTION public.cancel_expired_p2p_trades()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_trade RECORD;
  v_cancelled_count INTEGER := 0;
BEGIN
  FOR v_trade IN 
    SELECT id, seller_id, crypto, crypto_amount, escrow_fee 
    FROM public.trades 
    WHERE status = 'pending' 
      AND expires_at < NOW()
    FOR UPDATE
  LOOP
    -- Release locked escrow back to seller
    UPDATE public.balances
    SET available_balance = available_balance + (v_trade.crypto_amount + v_trade.escrow_fee),
        locked_balance = GREATEST(0, locked_balance - (v_trade.crypto_amount + v_trade.escrow_fee)),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND asset = UPPER(v_trade.crypto);

    -- Mark trade as cancelled / expired
    UPDATE public.trades
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = v_trade.id;

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  RETURN v_cancelled_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_expired_p2p_trades FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades TO authenticated, service_role, postgres;


-- 4. ON-CHAIN DEPOSIT IDEMPOTENT CREDITING RPC
CREATE OR REPLACE FUNCTION public.credit_onchain_deposit(
  p_user_id UUID,
  p_asset_code TEXT,
  p_network_code TEXT,
  p_amount NUMERIC,
  p_tx_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_existing_tx UUID;
BEGIN
  -- Idempotency check on tx_hash
  SELECT id INTO v_existing_tx FROM public.transactions WHERE tx_hash = p_tx_hash AND type = 'deposit';
  IF v_existing_tx IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Transaction already credited');
  END IF;

  -- Upsert balance
  INSERT INTO public.balances (user_id, asset, available_balance, locked_balance, created_at, updated_at)
  VALUES (p_user_id, UPPER(p_asset_code), p_amount, 0, NOW(), NOW())
  ON CONFLICT (user_id, asset)
  DO UPDATE SET available_balance = public.balances.available_balance + p_amount,
                updated_at = NOW();

  -- Record transaction ledger entry
  INSERT INTO public.transactions (user_id, asset, amount, type, status, tx_hash, network, created_at)
  VALUES (p_user_id, UPPER(p_asset_code), p_amount, 'deposit', 'completed', p_tx_hash, UPPER(p_network_code), NOW());

  RETURN jsonb_build_object('success', true, 'message', 'Deposit credited successfully');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_onchain_deposit FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_onchain_deposit TO service_role, postgres;
