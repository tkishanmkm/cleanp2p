-- ==============================================================================
-- 20260920000000_buyer_dispute_cancel_and_balance_fix.sql
-- Fix relation "public.user_balances" does not exist error
-- Escrow Logic:
--   1. Cancellation: Full crypto amount + escrow fee is refunded to seller available balance (no fee deducted).
--   2. Release: Crypto amount is credited to buyer available balance, and crypto amount + escrow fee is deducted from seller locked balance (escrow fee deducted).
--   3. Buyer Dispute Cancellation: Buyer can cancel trade even if in dispute or marked paid.
-- ==============================================================================

-- 1. Create public.user_balances table for full backwards compatibility
CREATE TABLE IF NOT EXISTS public.user_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset TEXT NOT NULL DEFAULT 'USDT',
    asset_symbol TEXT DEFAULT 'USDT',
    available_balance NUMERIC(36, 18) NOT NULL DEFAULT 0.00000000,
    locked_balance NUMERIC(36, 18) NOT NULL DEFAULT 0.00000000,
    amount NUMERIC(36, 18) DEFAULT 0.00000000,
    balance NUMERIC(36, 18) DEFAULT 0.00000000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_balances_user_asset_unique UNIQUE (user_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_user_balances_user_asset ON public.user_balances (user_id, asset);
ALTER TABLE public.user_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_balances_select_policy" ON public.user_balances;
CREATE POLICY "user_balances_select_policy" ON public.user_balances
    FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "user_balances_all_admin" ON public.user_balances;
CREATE POLICY "user_balances_all_admin" ON public.user_balances
    FOR ALL USING (auth.role() = 'service_role');


-- 2. Cleanly drop all prior overloaded function signatures to avoid ambiguity error 42725
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname IN ('cancel_p2p_trade', 'release_trade_escrow')
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;


-- 3. CANCEL P2P TRADE RPC (Enhanced for buyer dispute cancellation & full seller refund)
CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
  p_trade_id UUID,
  p_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'Cancelled by user'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade RECORD;
  v_caller_id UUID;
  v_coin_amount NUMERIC(36, 18);
  v_fee_amount NUMERIC(36, 18);
  v_total_refund NUMERIC(36, 18);
  v_asset_code TEXT;
  v_is_buyer BOOLEAN;
  v_is_seller BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  v_caller_id := COALESCE(p_user_id, auth.uid());

  -- 1. Fetch trade record
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF v_trade.id IS NULL THEN
    -- Fallback to p2p_trades if trades row not found
    SELECT * INTO v_trade
    FROM public.p2p_trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF v_trade.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Trade not found.');
    END IF;
  END IF;

  -- 2. Authorization check
  v_is_buyer := (v_caller_id IS NOT NULL AND v_caller_id = v_trade.buyer_id);
  v_is_seller := (v_caller_id IS NOT NULL AND v_caller_id = v_trade.seller_id);
  v_is_admin := (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = v_caller_id));

  IF NOT (v_is_buyer OR v_is_seller OR v_is_admin) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: You are not a participant in this trade.');
  END IF;

  -- 3. Guard: Never cancel a released or completed trade
  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('completed', 'released') OR v_trade.escrow_status = 'RELEASED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trade cannot be cancelled because it has already been released.');
  END IF;

  -- 4. Seller restriction: Seller cannot cancel if buyer has marked paid or if trade is in dispute without buyer consent
  IF v_is_seller AND NOT v_is_admin THEN
    IF v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL OR v_trade.escrow_status = 'PAID' OR LOWER(COALESCE(v_trade.status::text, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Seller cannot cancel after the buyer has marked payment as sent.');
    END IF;

    IF LOWER(COALESCE(v_trade.status::text, '')) IN ('disputed', 'dispute') OR v_trade.escrow_status = 'DISPUTED' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Seller cannot cancel a trade that is currently in dispute.');
    END IF;
  END IF;

  -- 5. Calculate amounts
  v_coin_amount := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
  v_fee_amount := COALESCE(v_trade.escrow_fee, v_coin_amount * 0.015, 0);
  v_total_refund := v_coin_amount + v_fee_amount; -- Full amount + escrow fee refunded to seller upon cancellation
  v_asset_code := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));

  -- 6. Refund locked escrow to seller across all wallet / balance tables
  IF v_trade.seller_id IS NOT NULL AND v_total_refund > 0 THEN
    -- Table: balances
    UPDATE public.balances
    SET available_balance = available_balance + v_total_refund,
        locked_balance = GREATEST(0, locked_balance - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset) = v_asset_code;

    -- Table: user_wallets
    UPDATE public.user_wallets
    SET available_balance = COALESCE(available_balance, balance, 0) + v_total_refund,
        locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
        balance = COALESCE(balance, 0) + v_total_refund,
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallet_assets
    UPDATE public.wallet_assets
    SET available = COALESCE(available, balance, 0) + v_total_refund,
        locked_escrow = GREATEST(0, COALESCE(locked_escrow, locked_balance, 0) - v_total_refund),
        locked_balance = GREATEST(0, COALESCE(locked_balance, locked_escrow, 0) - v_total_refund),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallets
    UPDATE public.wallets
    SET available_balance = available_balance + v_total_refund,
        locked_balance = GREATEST(0, locked_balance - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(currency) = v_asset_code;

    -- Table: user_balances (safe fallback)
    UPDATE public.user_balances
    SET available_balance = available_balance + v_total_refund,
        locked_balance = GREATEST(0, locked_balance - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset) = v_asset_code;
  END IF;

  -- 7. Update trade status to cancelled
  UPDATE public.trades
  SET status = 'cancelled',
      escrow_status = 'CANCELLED',
      cancellation_reason = p_reason,
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE id = p_trade_id;

  -- Also sync p2p_trades if present
  UPDATE public.p2p_trades
  SET status = 'CANCELLED',
      updated_at = NOW()
  WHERE id = p_trade_id;

  -- 8. If trade was in dispute, resolve the dispute
  UPDATE public.disputes
  SET status = 'RESOLVED',
      admin_decision = CASE WHEN v_is_buyer THEN 'CANCELLED_BY_BUYER' ELSE 'REFUND_SELLER' END,
      resolved_at = NOW()
  WHERE trade_id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Trade cancelled successfully. Escrow refunded to seller.',
    'trade_id', p_trade_id,
    'refund_amount', v_total_refund
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;


-- 4. RELEASE P2P ESCROW RPC (Transfers coin to buyer, deducts escrow fee from seller)
CREATE OR REPLACE FUNCTION public.release_trade_escrow(
  p_trade_id UUID,
  p_seller_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade RECORD;
  v_caller_id UUID;
  v_coin_amount NUMERIC(36, 18);
  v_fee_amount NUMERIC(36, 18);
  v_total_deduct NUMERIC(36, 18);
  v_asset_code TEXT;
  v_is_seller BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  v_caller_id := COALESCE(p_seller_id, auth.uid());

  -- 1. Fetch trade record
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF v_trade.id IS NULL THEN
    SELECT * INTO v_trade
    FROM public.p2p_trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF v_trade.id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'message', 'Trade not found.');
    END IF;
  END IF;

  -- 2. Authorization check
  v_is_seller := (v_caller_id IS NOT NULL AND v_caller_id = v_trade.seller_id);
  v_is_admin := (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = v_caller_id));

  IF NOT (v_is_seller OR v_is_admin) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Only the seller or an administrator can release escrow.');
  END IF;

  -- 3. Status check: Guard against double-release or releasing cancelled trades
  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('completed', 'released') OR v_trade.escrow_status = 'RELEASED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Escrow has already been released for this trade.');
  END IF;

  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('cancelled', 'expired') OR v_trade.escrow_status IN ('CANCELLED', 'EXPIRED') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot release escrow for a cancelled or expired trade.');
  END IF;

  -- 4. Calculate amounts
  v_coin_amount := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
  v_fee_amount := COALESCE(v_trade.escrow_fee, v_coin_amount * 0.015, 0);
  v_total_deduct := v_coin_amount + v_fee_amount; -- Seller locked escrow had amount + fee locked
  v_asset_code := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));

  -- 5. Deduct locked balance from seller
  IF v_trade.seller_id IS NOT NULL AND v_total_deduct > 0 THEN
    -- Table: balances
    UPDATE public.balances
    SET locked_balance = GREATEST(0, locked_balance - v_total_deduct),
        total_balance = GREATEST(0, total_balance - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset) = v_asset_code;

    -- Table: user_wallets
    UPDATE public.user_wallets
    SET locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_deduct),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_deduct),
        balance = GREATEST(0, COALESCE(balance, 0) - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallet_assets
    UPDATE public.wallet_assets
    SET locked_escrow = GREATEST(0, COALESCE(locked_escrow, locked_balance, 0) - v_total_deduct),
        locked_balance = GREATEST(0, COALESCE(locked_balance, locked_escrow, 0) - v_total_deduct),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallets
    UPDATE public.wallets
    SET locked_balance = GREATEST(0, locked_balance - v_total_deduct),
        total_balance = GREATEST(0, total_balance - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(currency) = v_asset_code;

    -- Table: user_balances
    UPDATE public.user_balances
    SET locked_balance = GREATEST(0, locked_balance - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND UPPER(asset) = v_asset_code;
  END IF;

  -- 6. Credit buyer available balance
  IF v_trade.buyer_id IS NOT NULL AND v_coin_amount > 0 THEN
    -- Table: balances
    INSERT INTO public.balances (user_id, asset, available_balance, locked_balance, total_balance, created_at, updated_at)
    VALUES (v_trade.buyer_id, v_asset_code, v_coin_amount, 0, v_coin_amount, NOW(), NOW())
    ON CONFLICT (user_id, asset)
    DO UPDATE SET available_balance = public.balances.available_balance + v_coin_amount,
                  total_balance = public.balances.total_balance + v_coin_amount,
                  updated_at = NOW();

    -- Table: user_wallets
    INSERT INTO public.user_wallets (user_id, asset_symbol, available_balance, locked_balance, balance, created_at, updated_at)
    VALUES (v_trade.buyer_id, v_asset_code, v_coin_amount, 0, v_coin_amount, NOW(), NOW())
    ON CONFLICT DO NOTHING;

    UPDATE public.user_wallets
    SET available_balance = COALESCE(available_balance, balance, 0) + v_coin_amount,
        balance = COALESCE(balance, 0) + v_coin_amount,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallet_assets
    INSERT INTO public.wallet_assets (user_id, asset_symbol, available, locked_escrow, locked_balance, updated_at)
    VALUES (v_trade.buyer_id, v_asset_code, v_coin_amount, 0, 0, NOW())
    ON CONFLICT DO NOTHING;

    UPDATE public.wallet_assets
    SET available = COALESCE(available, balance, 0) + v_coin_amount,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id AND UPPER(asset_symbol) = v_asset_code;

    -- Table: wallets
    INSERT INTO public.wallets (user_id, currency, available_balance, locked_balance, total_balance, updated_at)
    VALUES (v_trade.buyer_id, v_asset_code, v_coin_amount, 0, v_coin_amount, NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET available_balance = public.wallets.available_balance + v_coin_amount,
        total_balance = public.wallets.total_balance + v_coin_amount,
        updated_at = NOW();

    -- Table: user_balances
    INSERT INTO public.user_balances (user_id, asset, asset_symbol, available_balance, locked_balance, balance, updated_at)
    VALUES (v_trade.buyer_id, v_asset_code, v_asset_code, v_coin_amount, 0, v_coin_amount, NOW())
    ON CONFLICT (user_id, asset)
    DO UPDATE SET available_balance = public.user_balances.available_balance + v_coin_amount,
                  updated_at = NOW();
  END IF;

  -- 7. Mark trade completed / released
  UPDATE public.trades
  SET status = 'released',
      escrow_status = 'RELEASED',
      released_at = NOW(),
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_trade_id;

  UPDATE public.p2p_trades
  SET status = 'COMPLETED',
      updated_at = NOW()
  WHERE id = p_trade_id;

  -- 8. If dispute existed, mark resolved
  UPDATE public.disputes
  SET status = 'RESOLVED',
      admin_decision = 'RELEASE_BUYER',
      resolved_at = NOW()
  WHERE trade_id = p_trade_id;

  -- 9. Increment completed trades for both profiles
  IF v_trade.seller_id IS NOT NULL THEN
    UPDATE public.profiles
    SET completed_trades = COALESCE(completed_trades, 0) + 1,
        updated_at = NOW()
    WHERE id = v_trade.seller_id;
  END IF;

  IF v_trade.buyer_id IS NOT NULL THEN
    UPDATE public.profiles
    SET completed_trades = COALESCE(completed_trades, 0) + 1,
        updated_at = NOW()
    WHERE id = v_trade.buyer_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Escrow released successfully. Coin transferred to buyer.',
    'trade_id', p_trade_id,
    'buyer_credit', v_coin_amount
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO authenticated, service_role, postgres;
