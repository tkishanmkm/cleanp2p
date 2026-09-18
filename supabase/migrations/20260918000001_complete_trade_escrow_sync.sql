-- ==============================================================================
-- COMPLETE TRADE ESCROW, BALANCE SYNC, EXPIRY GUARD & DISPUTE MIGRATION
-- ==============================================================================

-- 1. Hardened Trade Escrow Release RPC
CREATE OR REPLACE FUNCTION public.release_trade_escrow(
  p_trade_id UUID,
  p_seller_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_trade RECORD;
  v_crypto_sym TEXT;
  v_crypto_amt NUMERIC(36, 18);
  v_fee_amt NUMERIC(36, 18);
  v_total_deduct NUMERIC(36, 18);
  v_seller_wallet_id UUID;
  v_buyer_wallet_id UUID;
  v_seller_avail NUMERIC(36, 18) := 0;
  v_seller_locked NUMERIC(36, 18) := 0;
  v_buyer_avail NUMERIC(36, 18) := 0;
  v_buyer_username TEXT := 'Buyer';
  v_seller_username TEXT := 'Seller';
BEGIN
  -- 1. Fetch & lock trade row
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found.', p_trade_id;
  END IF;

  -- 2. Authorization check: Seller or Admin or matching seller_id param
  IF v_caller_id IS NOT NULL THEN
    IF v_trade.seller_id <> v_caller_id AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only the trade seller or admin can release escrow.';
    END IF;
  ELSIF p_seller_id IS NOT NULL AND v_trade.seller_id <> p_seller_id THEN
    RAISE EXCEPTION 'Seller ID mismatch for trade release.';
  END IF;

  -- 3. Guard against duplicate releases or invalid states
  IF v_trade.status IN ('completed', 'released') OR v_trade.escrow_status = 'RELEASED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'trade_id', p_trade_id,
      'status', 'released',
      'message', 'Trade escrow was already released.'
    );
  END IF;

  IF v_trade.status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'Cannot release escrow for a % trade.', v_trade.status;
  END IF;

  v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));
  v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
  v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.platform_fee, 0);
  v_total_deduct := v_crypto_amt + v_fee_amt;

  -- 4. Get User Profile Usernames for system logging & notifications
  SELECT username INTO v_seller_username FROM public.profiles WHERE id = v_trade.seller_id;
  SELECT username INTO v_buyer_username FROM public.profiles WHERE id = v_trade.buyer_id;

  -- 5. Fetch or Create Wallets for Seller & Buyer
  SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id LIMIT 1;
  IF v_seller_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, is_primary)
    VALUES (v_trade.seller_id, 'USD', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_seller_wallet_id;
    IF v_seller_wallet_id IS NULL THEN
      SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id LIMIT 1;
    END IF;
  END IF;

  SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_trade.buyer_id LIMIT 1;
  IF v_buyer_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, is_primary)
    VALUES (v_trade.buyer_id, 'USD', true)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_buyer_wallet_id;
    IF v_buyer_wallet_id IS NULL THEN
      SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_trade.buyer_id LIMIT 1;
    END IF;
  END IF;

  -- 6. Atomic Seller Escrow Deduction across wallet_assets, user_wallets, and balances
  IF v_seller_wallet_id IS NOT NULL THEN
    UPDATE public.wallet_assets
    SET locked_escrow = GREATEST(0, COALESCE(locked_escrow, 0) - v_total_deduct),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_deduct),
        updated_at = NOW()
    WHERE (wallet_id = v_seller_wallet_id OR user_id = v_trade.seller_id)
      AND (asset_code = v_crypto_sym OR asset_symbol = v_crypto_sym);
  END IF;

  UPDATE public.user_wallets
  SET locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_deduct),
      reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_deduct),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset_symbol = v_crypto_sym;

  UPDATE public.balances
  SET locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_deduct),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset = v_crypto_sym;

  -- 7. Atomic Buyer Crypto Credit across wallet_assets, user_wallets, and balances
  IF v_buyer_wallet_id IS NOT NULL THEN
    INSERT INTO public.wallet_assets (
      wallet_id, user_id, asset_code, asset_symbol, available, locked_escrow, created_at, updated_at
    )
    VALUES (
      v_buyer_wallet_id, v_trade.buyer_id, v_crypto_sym, v_crypto_sym, v_crypto_amt, 0, NOW(), NOW()
    )
    ON CONFLICT (wallet_id, asset_code) DO UPDATE
    SET available = public.wallet_assets.available + v_crypto_amt,
        updated_at = NOW();
  END IF;

  INSERT INTO public.user_wallets (
    user_id, asset_symbol, available_balance, locked_balance, balance, created_at, updated_at
  )
  VALUES (
    v_trade.buyer_id, v_crypto_sym, v_crypto_amt, 0, v_crypto_amt, NOW(), NOW()
  )
  ON CONFLICT (user_id, asset_symbol) DO UPDATE
  SET available_balance = COALESCE(public.user_wallets.available_balance, 0) + v_crypto_amt,
      balance = COALESCE(public.user_wallets.balance, 0) + v_crypto_amt,
      updated_at = NOW();

  INSERT INTO public.balances (
    user_id, asset, available_balance, locked_balance, created_at, updated_at
  )
  VALUES (
    v_trade.buyer_id, v_crypto_sym, v_crypto_amt, 0, NOW(), NOW()
  )
  ON CONFLICT (user_id, asset) DO UPDATE
  SET available_balance = COALESCE(public.balances.available_balance, 0) + v_crypto_amt,
      updated_at = NOW();

  -- 8. Ledger Entries for Accounting & Audit
  IF v_seller_wallet_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      wallet_id, user_id, asset_code, delta_available, delta_locked,
      available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
      v_seller_wallet_id, v_trade.seller_id, v_crypto_sym, 0, -v_total_deduct,
      0, 0, 'escrow_release', 'trades', v_trade.id::TEXT, 'seller_rel_' || v_trade.id::TEXT
    )
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_buyer_wallet_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (
      wallet_id, user_id, asset_code, delta_available, delta_locked,
      available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
      v_buyer_wallet_id, v_trade.buyer_id, v_crypto_sym, +v_crypto_amt, 0,
      v_crypto_amt, 0, 'escrow_release', 'trades', v_trade.id::TEXT, 'buyer_rel_' || v_trade.id::TEXT
    )
    ON CONFLICT DO NOTHING;
  END IF;

  -- 9. Update Trade Record
  UPDATE public.trades
  SET status = 'completed',
      escrow_status = 'RELEASED',
      released_at = NOW(),
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_trade_id;

  -- 10. Increment completed_trades & positive score for both parties
  UPDATE public.profiles
  SET completed_trades = COALESCE(completed_trades, 0) + 1,
      total_completed_trades = COALESCE(total_completed_trades, 0) + 1,
      updated_at = NOW()
  WHERE id IN (v_trade.seller_id, v_trade.buyer_id);

  -- 11. Insert Notification for Buyer
  INSERT INTO public.notifications (
    user_id, title, message, link, is_read, created_at
  )
  VALUES (
    v_trade.buyer_id,
    'Escrow Released',
    format('@%s released %s %s to your wallet.', COALESCE(v_seller_username, 'Seller'), v_crypto_amt, v_crypto_sym),
    '/trade/' || p_trade_id::TEXT,
    false,
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'credited_amount', v_crypto_amt,
    'status', 'completed',
    'message', 'Escrow successfully released to buyer.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.release_trade_escrow FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow TO authenticated, service_role, postgres;


-- 2. Hardened Cancel Trade RPC (Guarded against paid trades)
CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
  p_trade_id UUID,
  p_user_id UUID,
  p_reason TEXT DEFAULT 'Cancelled by user'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_trade RECORD;
  v_crypto_sym TEXT;
  v_crypto_amt NUMERIC(36, 18);
  v_fee_amt NUMERIC(36, 18);
  v_total_refund NUMERIC(36, 18);
  v_seller_wallet_id UUID;
BEGIN
  -- 1. Fetch & lock trade
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found.', p_trade_id;
  END IF;

  -- 2. Authorization check
  IF v_caller_id IS NOT NULL THEN
    IF v_trade.buyer_id <> v_caller_id AND v_trade.seller_id <> v_caller_id AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Unauthorized to cancel this trade.';
    END IF;
  END IF;

  -- 3. Strict Guard: Never cancel a paid, released, or disputed trade
  IF v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL OR v_trade.escrow_status = 'PAID' OR v_trade.status IN ('paid', 'buyer_marked_paid', 'payment_sent') THEN
    RAISE EXCEPTION 'Trade cannot be cancelled because it has already been marked as paid.';
  END IF;

  IF v_trade.status IN ('completed', 'released', 'disputed') OR v_trade.escrow_status IN ('RELEASED', 'DISPUTED') THEN
    RAISE EXCEPTION 'Trade status (%) does not permit cancellation.', v_trade.status;
  END IF;

  IF v_trade.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'trade_id', p_trade_id, 'status', 'cancelled', 'message', 'Trade already cancelled.');
  END IF;

  v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));
  v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
  v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.platform_fee, 0);
  v_total_refund := v_crypto_amt + v_fee_amt;

  -- 4. Refund Seller Escrow back to Available Balance
  SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id LIMIT 1;

  IF v_seller_wallet_id IS NOT NULL THEN
    UPDATE public.wallet_assets
    SET available = available + v_total_refund,
        locked_escrow = GREATEST(0, COALESCE(locked_escrow, 0) - v_total_refund),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
        updated_at = NOW()
    WHERE (wallet_id = v_seller_wallet_id OR user_id = v_trade.seller_id)
      AND (asset_code = v_crypto_sym OR asset_symbol = v_crypto_sym);
  END IF;

  UPDATE public.user_wallets
  SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
      locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
      reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset_symbol = v_crypto_sym;

  UPDATE public.balances
  SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
      locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset = v_crypto_sym;

  -- 5. Mark trade as cancelled
  UPDATE public.trades
  SET status = 'cancelled',
      escrow_status = 'CANCELLED',
      cancellation_reason = p_reason,
      cancelled_at = NOW(),
      updated_at = NOW()
  WHERE id = p_trade_id;

  RETURN jsonb_build_object(
    'success', true,
    'trade_id', p_trade_id,
    'refunded_amount', v_total_refund,
    'status', 'cancelled'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_p2p_trade FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade TO authenticated, service_role, postgres;


-- 3. Hardened Trade Expiry RPC (Strictly ignores Paid Trades)
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
BEGIN
  SELECT * INTO v_trade
  FROM public.trades
  WHERE id = p_trade_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found.', p_trade_id;
  END IF;

  -- Critical Check: Do NOT expire if marked as paid, completed, released, or disputed
  IF v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL OR v_trade.escrow_status = 'PAID' OR v_trade.status IN ('paid', 'buyer_marked_paid', 'payment_sent') THEN
    RETURN jsonb_build_object(
      'success', false,
      'trade_id', p_trade_id,
      'status', v_trade.status,
      'message', 'Trade was marked as paid and cannot be expired.'
    );
  END IF;

  IF v_trade.status IN ('completed', 'released', 'disputed', 'cancelled', 'expired') THEN
    RETURN jsonb_build_object(
      'success', false,
      'trade_id', p_trade_id,
      'status', v_trade.status,
      'message', 'Trade is already finalized or expired.'
    );
  END IF;

  v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));
  v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
  v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.platform_fee, 0);
  v_total_refund := v_crypto_amt + v_fee_amt;

  -- Refund Seller Escrow
  SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id LIMIT 1;

  IF v_seller_wallet_id IS NOT NULL THEN
    UPDATE public.wallet_assets
    SET available = available + v_total_refund,
        locked_escrow = GREATEST(0, COALESCE(locked_escrow, 0) - v_total_refund),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
        updated_at = NOW()
    WHERE (wallet_id = v_seller_wallet_id OR user_id = v_trade.seller_id)
      AND (asset_code = v_crypto_sym OR asset_symbol = v_crypto_sym);
  END IF;

  UPDATE public.user_wallets
  SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
      locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
      reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset_symbol = v_crypto_sym;

  UPDATE public.balances
  SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
      locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
      updated_at = NOW()
  WHERE user_id = v_trade.seller_id AND asset = v_crypto_sym;

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

REVOKE EXECUTE ON FUNCTION public.expire_p2p_trade FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_p2p_trade TO authenticated, service_role, postgres;


-- 4. Guarded cancel_expired_p2p_trades background runner
CREATE OR REPLACE FUNCTION public.cancel_expired_p2p_trades()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_trade RECORD;
  v_cancelled_count INTEGER := 0;
  v_crypto_sym TEXT;
  v_total_refund NUMERIC(36, 18);
  v_seller_wallet_id UUID;
BEGIN
  FOR v_trade IN 
    SELECT id, seller_id, crypto, asset_symbol, crypto_amount, amount, escrow_fee, platform_fee
    FROM public.trades 
    WHERE status IN ('pending', 'active') 
      AND expires_at < NOW()
      AND paid_at IS NULL
      AND marked_paid_at IS NULL
      AND payment_confirmed_at IS NULL
      AND escrow_status IS DISTINCT FROM 'PAID'
    FOR UPDATE
  LOOP
    v_crypto_sym := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, 'USDT'));
    v_total_refund := COALESCE(v_trade.crypto_amount, v_trade.amount, 0) + COALESCE(v_trade.escrow_fee, v_trade.platform_fee, 0);

    -- Release locked escrow back to seller
    SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id LIMIT 1;
    IF v_seller_wallet_id IS NOT NULL THEN
      UPDATE public.wallet_assets
      SET available = available + v_total_refund,
          locked_escrow = GREATEST(0, COALESCE(locked_escrow, 0) - v_total_refund),
          reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
          updated_at = NOW()
      WHERE (wallet_id = v_seller_wallet_id OR user_id = v_trade.seller_id)
        AND (asset_code = v_crypto_sym OR asset_symbol = v_crypto_sym);
    END IF;

    UPDATE public.user_wallets
    SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
        locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
        reserved_balance = GREATEST(0, COALESCE(reserved_balance, 0) - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND asset_symbol = v_crypto_sym;

    UPDATE public.balances
    SET available_balance = COALESCE(available_balance, 0) + v_total_refund,
        locked_balance = GREATEST(0, COALESCE(locked_balance, 0) - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND asset = v_crypto_sym;

    -- Mark trade as expired
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

REVOKE EXECUTE ON FUNCTION public.cancel_expired_p2p_trades FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades TO authenticated, service_role, postgres;
