-- ==============================================================================
-- 20260920000004_fix_available_balance_column_error.sql
-- Fixes PostgreSQL Error: column "available_balance" does not exist
--
-- Root Cause:
-- 1. `public.wallets` is the user container table (id, user_id, status) and
--    does NOT have an `available_balance` column.
-- 2. Spot balances and locked escrow are stored in `public.wallet_assets`
--    linked via `wallet_id` referencing `public.wallets.id` with columns:
--    `available`, `locked_escrow`, `locked_withdrawal`, `asset_code`.
-- 3. `public.user_wallets` is a VIEW joining `wallet_assets` and `wallets`.
-- ==============================================================================

-- 1. Drop existing functions cleanly
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname IN ('cancel_p2p_trade', 'release_trade_escrow', 'expire_p2p_trade', 'cancel_expired_p2p_trades')
          AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;


-- ==============================================================================
-- 2. CANCEL P2P TRADE RPC (Targeting public.wallet_assets accurately)
-- ==============================================================================
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
  v_seller_wallet_id UUID;
  v_seller_uuid UUID;
BEGIN
  v_caller_id := COALESCE(p_user_id, auth.uid());

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

  -- 2. Authorization check with explicit TEXT comparisons
  v_is_buyer := (v_caller_id IS NOT NULL AND v_caller_id::TEXT = v_trade.buyer_id::TEXT);
  v_is_seller := (v_caller_id IS NOT NULL AND v_caller_id::TEXT = v_trade.seller_id::TEXT);
  v_is_admin := (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id::TEXT = v_caller_id::TEXT));

  IF NOT (v_is_buyer OR v_is_seller OR v_is_admin) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: You are not a participant in this trade.');
  END IF;

  -- 3. Guard: Never cancel a released or completed trade
  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('completed', 'released') OR v_trade.escrow_status = 'RELEASED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trade cannot be cancelled because it has already been released.');
  END IF;

  -- 4. Seller restriction: Seller cannot cancel if buyer has marked paid or if trade is in dispute
  IF v_is_seller AND NOT v_is_admin THEN
    IF v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL OR v_trade.escrow_status = 'PAID' OR LOWER(COALESCE(v_trade.status::text, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent') THEN
      RETURN jsonb_build_object('success', false, 'message', 'Seller cannot cancel after the buyer has marked payment as sent.');
    END IF;

    IF LOWER(COALESCE(v_trade.status::text, '')) IN ('disputed', 'dispute') OR v_trade.escrow_status = 'DISPUTED' THEN
      RETURN jsonb_build_object('success', false, 'message', 'Seller cannot cancel a trade that is currently in dispute.');
    END IF;
  END IF;

  -- 5. Calculate amounts using exact columns present in public.trades
  v_coin_amount := COALESCE(v_trade.crypto_amount, v_trade.amount, v_trade.amount_crypto, 0);
  v_fee_amount := COALESCE(v_trade.escrow_fee, v_trade.fee_crypto, v_coin_amount * 0.015, 0);
  v_total_refund := v_coin_amount + v_fee_amount; -- Full amount + escrow fee refunded to seller upon cancellation
  v_asset_code := UPPER(COALESCE(v_trade.crypto, v_trade.asset, v_trade.crypto_currency, v_trade.asset_code, v_trade.coin, 'USDT'));

  -- Safe cast of seller_id to UUID
  BEGIN
    v_seller_uuid := v_trade.seller_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_seller_uuid := NULL;
  END;

  -- 6. Refund locked escrow to seller in public.wallet_assets
  IF v_trade.seller_id IS NOT NULL AND v_total_refund > 0 THEN
    -- Get or create the seller's wallet container
    SELECT id INTO v_seller_wallet_id 
    FROM public.wallets 
    WHERE user_id::TEXT = v_trade.seller_id::TEXT;

    IF v_seller_wallet_id IS NULL AND v_seller_uuid IS NOT NULL THEN
      INSERT INTO public.wallets (user_id, status, provisioning_status)
      VALUES (v_seller_uuid, 'active', 'completed')
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING id INTO v_seller_wallet_id;
    END IF;

    IF v_seller_wallet_id IS NOT NULL THEN
      -- Insert wallet_assets row if it doesn't exist
      INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at)
      VALUES (v_seller_wallet_id, v_asset_code, v_total_refund, 0, 0, NOW())
      ON CONFLICT (wallet_id, asset_code)
      DO UPDATE SET 
        available = public.wallet_assets.available + v_total_refund,
        locked_escrow = GREATEST(0, public.wallet_assets.locked_escrow - v_total_refund),
        updated_at = NOW();
    END IF;

    -- Also safely update user_balances table if present
    BEGIN
      UPDATE public.user_balances
      SET available_balance = available_balance + v_total_refund,
          locked_balance = GREATEST(0, locked_balance - v_total_refund),
          balance = balance + v_total_refund,
          updated_at = NOW()
      WHERE user_id::TEXT = v_trade.seller_id::TEXT AND UPPER(asset) = v_asset_code;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
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
      resolved_at = NOW()
  WHERE trade_id::TEXT = p_trade_id::TEXT;

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


-- ==============================================================================
-- 3. RELEASE P2P ESCROW RPC (Targeting public.wallet_assets accurately)
-- ==============================================================================
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
  v_seller_wallet_id UUID;
  v_buyer_wallet_id UUID;
  v_buyer_uuid UUID;
  v_seller_uuid UUID;
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

  -- 2. Authorization check with explicit TEXT comparison
  v_is_seller := (v_caller_id IS NOT NULL AND v_caller_id::TEXT = v_trade.seller_id::TEXT);
  v_is_admin := (auth.role() = 'service_role' OR EXISTS (SELECT 1 FROM public.app_admins WHERE user_id::TEXT = v_caller_id::TEXT));

  IF NOT (v_is_seller OR v_is_admin) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Unauthorized: Only the seller or an administrator can release escrow.');
  END IF;

  -- 3. Guard against double-release or releasing cancelled trades
  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('completed', 'released') OR v_trade.escrow_status = 'RELEASED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Escrow has already been released for this trade.');
  END IF;

  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('cancelled', 'expired') OR v_trade.escrow_status IN ('CANCELLED', 'EXPIRED') THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cannot release escrow for a cancelled or expired trade.');
  END IF;

  -- 4. Calculate amounts using exact columns present in public.trades
  v_coin_amount := COALESCE(v_trade.crypto_amount, v_trade.amount, v_trade.amount_crypto, 0);
  v_fee_amount := COALESCE(v_trade.escrow_fee, v_trade.fee_crypto, v_coin_amount * 0.015, 0);
  v_total_deduct := v_coin_amount + v_fee_amount; -- Deduct full escrow (amount + fee) from seller
  v_asset_code := UPPER(COALESCE(v_trade.crypto, v_trade.asset, v_trade.crypto_currency, v_trade.asset_code, v_trade.coin, 'USDT'));

  -- Safe conversion of buyer_id & seller_id to UUID
  BEGIN
    v_buyer_uuid := v_trade.buyer_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_buyer_uuid := NULL;
  END;

  BEGIN
    v_seller_uuid := v_trade.seller_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_seller_uuid := NULL;
  END;

  -- 5. Deduct locked balance from seller
  IF v_trade.seller_id IS NOT NULL AND v_total_deduct > 0 THEN
    SELECT id INTO v_seller_wallet_id 
    FROM public.wallets 
    WHERE user_id::TEXT = v_trade.seller_id::TEXT;

    IF v_seller_wallet_id IS NOT NULL THEN
      UPDATE public.wallet_assets
      SET locked_escrow = GREATEST(0, locked_escrow - v_total_deduct),
          updated_at = NOW()
      WHERE wallet_id = v_seller_wallet_id AND UPPER(asset_code) = v_asset_code;
    END IF;

    BEGIN
      UPDATE public.user_balances
      SET locked_balance = GREATEST(0, locked_balance - v_total_deduct),
          balance = GREATEST(0, balance - v_total_deduct),
          updated_at = NOW()
      WHERE user_id::TEXT = v_trade.seller_id::TEXT AND UPPER(asset) = v_asset_code;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- 6. Credit buyer available balance
  IF v_trade.buyer_id IS NOT NULL AND v_coin_amount > 0 THEN
    SELECT id INTO v_buyer_wallet_id 
    FROM public.wallets 
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT;

    IF v_buyer_wallet_id IS NULL AND v_buyer_uuid IS NOT NULL THEN
      INSERT INTO public.wallets (user_id, status, provisioning_status)
      VALUES (v_buyer_uuid, 'active', 'completed')
      ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
      RETURNING id INTO v_buyer_wallet_id;
    END IF;

    IF v_buyer_wallet_id IS NOT NULL THEN
      INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at)
      VALUES (v_buyer_wallet_id, v_asset_code, v_coin_amount, 0, 0, NOW())
      ON CONFLICT (wallet_id, asset_code)
      DO UPDATE SET 
        available = public.wallet_assets.available + v_coin_amount,
        updated_at = NOW();
    END IF;

    BEGIN
      INSERT INTO public.user_balances (user_id, asset, asset_symbol, available_balance, locked_balance, balance, updated_at)
      VALUES (v_buyer_uuid, v_asset_code, v_asset_code, v_coin_amount, 0, v_coin_amount, NOW())
      ON CONFLICT (user_id, asset)
      DO UPDATE SET available_balance = public.user_balances.available_balance + v_coin_amount,
                    balance = public.user_balances.balance + v_coin_amount,
                    updated_at = NOW();
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
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
      resolved_at = NOW()
  WHERE trade_id::TEXT = p_trade_id::TEXT;

  -- 9. Increment completed trades for profiles
  IF v_trade.seller_id IS NOT NULL THEN
    UPDATE public.profiles
    SET completed_trades = COALESCE(completed_trades, 0) + 1,
        updated_at = NOW()
    WHERE id::TEXT = v_trade.seller_id::TEXT;
  END IF;

  IF v_trade.buyer_id IS NOT NULL THEN
    UPDATE public.profiles
    SET completed_trades = COALESCE(completed_trades, 0) + 1,
        updated_at = NOW()
    WHERE id::TEXT = v_trade.buyer_id::TEXT;
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


-- ==============================================================================
-- 4. EXPIRE P2P TRADE RPC (Targeting public.wallet_assets accurately)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.expire_p2p_trade(
  p_trade_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trade RECORD;
  v_crypto_sym TEXT;
  v_crypto_amt NUMERIC(36, 18);
  v_fee_amt NUMERIC(36, 18);
  v_total_refund NUMERIC(36, 18);
  v_seller_wallet_id UUID;
  v_seller_uuid UUID;
BEGIN
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Trade not found.');
  END IF;

  -- Critical Check: Do NOT expire if marked as paid, completed, released, or disputed
  IF v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL OR v_trade.escrow_status = 'PAID' OR LOWER(COALESCE(v_trade.status::text, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent') THEN
    RETURN jsonb_build_object(
      'success', false,
      'trade_id', p_trade_id,
      'status', v_trade.status,
      'message', 'Trade was marked as paid and cannot be expired.'
    );
  END IF;

  IF LOWER(COALESCE(v_trade.status::text, '')) IN ('completed', 'released', 'disputed', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'success', false,
      'trade_id', p_trade_id,
      'status', v_trade.status,
      'message', 'Trade is already finalized or expired.'
    );
  END IF;

  v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset, v_trade.crypto_currency, v_trade.asset_code, v_trade.coin, 'USDT'));
  v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, v_trade.amount_crypto, 0);
  v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.fee_crypto, 0);
  v_total_refund := v_crypto_amt + v_fee_amt;

  BEGIN
    v_seller_uuid := v_trade.seller_id::UUID;
  EXCEPTION WHEN OTHERS THEN
    v_seller_uuid := NULL;
  END;

  -- Refund Seller Escrow in public.wallet_assets
  IF v_trade.seller_id IS NOT NULL AND v_total_refund > 0 THEN
    SELECT id INTO v_seller_wallet_id 
    FROM public.wallets 
    WHERE user_id::TEXT = v_trade.seller_id::TEXT;

    IF v_seller_wallet_id IS NOT NULL THEN
      UPDATE public.wallet_assets
      SET available = available + v_total_refund,
          locked_escrow = GREATEST(0, locked_escrow - v_total_refund),
          updated_at = NOW()
      WHERE wallet_id = v_seller_wallet_id AND UPPER(asset_code) = v_crypto_sym;
    END IF;

    BEGIN
      UPDATE public.user_balances
      SET available_balance = available_balance + v_total_refund,
          locked_balance = GREATEST(0, locked_balance - v_total_refund),
          balance = balance + v_total_refund,
          updated_at = NOW()
      WHERE user_id::TEXT = v_trade.seller_id::TEXT AND UPPER(asset) = v_crypto_sym;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- Mark trade as expired
  UPDATE public.trades
  SET status = 'expired',
      escrow_status = 'EXPIRED',
      updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'refunded_amount', v_total_refund,
    'status', 'expired'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_p2p_trade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_p2p_trade(UUID) TO authenticated, service_role, postgres;


-- ==============================================================================
-- 5. CANCEL EXPIRED P2P TRADES BATCH RUNNER (Targeting public.wallet_assets)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cancel_expired_p2p_trades()
RETURNS INTEGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp 
AS $$
DECLARE
  v_trade RECORD;
  v_cancelled_count INTEGER := 0;
  v_crypto_sym TEXT;
  v_total_refund NUMERIC(36, 18);
  v_seller_wallet_id UUID;
BEGIN
  FOR v_trade IN 
    SELECT id, seller_id, crypto, asset, crypto_currency, asset_code, coin, crypto_amount, amount, amount_crypto, escrow_fee, fee_crypto
    FROM public.trades 
    WHERE LOWER(status::text) IN ('pending', 'active') 
      AND expires_at < NOW()
      AND paid_at IS NULL
      AND marked_paid_at IS NULL
      AND payment_confirmed_at IS NULL
      AND escrow_status IS DISTINCT FROM 'PAID'
    FOR UPDATE
  LOOP
    v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset, v_trade.crypto_currency, v_trade.asset_code, v_trade.coin, 'USDT'));
    v_total_refund := COALESCE(v_trade.crypto_amount, v_trade.amount, v_trade.amount_crypto, 0) + COALESCE(v_trade.escrow_fee, v_trade.fee_crypto, 0);

    -- Release locked escrow back to seller in wallet_assets
    IF v_trade.seller_id IS NOT NULL AND v_total_refund > 0 THEN
      SELECT id INTO v_seller_wallet_id 
      FROM public.wallets 
      WHERE user_id::TEXT = v_trade.seller_id::TEXT;

      IF v_seller_wallet_id IS NOT NULL THEN
        UPDATE public.wallet_assets
        SET available = available + v_total_refund,
            locked_escrow = GREATEST(0, locked_escrow - v_total_refund),
            updated_at = NOW()
        WHERE wallet_id = v_seller_wallet_id AND UPPER(asset_code) = v_crypto_sym;
      END IF;

      BEGIN
        UPDATE public.user_balances
        SET available_balance = available_balance + v_total_refund,
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            balance = balance + v_total_refund,
            updated_at = NOW()
        WHERE user_id::TEXT = v_trade.seller_id::TEXT AND UPPER(asset) = v_crypto_sym;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    UPDATE public.trades
    SET status = 'expired',
        escrow_status = 'EXPIRED',
        updated_at = NOW()
    WHERE id = v_trade.id;

    v_cancelled_count := v_cancelled_count + 1;
  END LOOP;

  RETURN v_cancelled_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() TO authenticated, service_role, postgres;
