-- ==============================================================================
-- Migration: 003_p2p_escrow_instant_lock_release.sql
-- Description: Instant Real-Time Escrow Locking & Fee Settlement Engine
-- ==============================================================================

-- 1. Helper function to ensure user wallet / balance rows exist
CREATE OR REPLACE FUNCTION public.ensure_user_balance_wallet(p_user_id UUID, p_asset TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Ensure in balances table
    INSERT INTO public.balances (user_id, asset, available_balance, locked_balance, total_balance, updated_at)
    VALUES (p_user_id, UPPER(p_asset), 0.00000000, 0.00000000, 0.00000000, NOW())
    ON CONFLICT (user_id, asset) DO NOTHING;

    -- Ensure in user_balances table
    INSERT INTO public.user_balances (user_id, asset, available_balance, locked_balance, updated_at)
    VALUES (p_user_id, UPPER(p_asset), 0.00000000, 0.00000000, NOW())
    ON CONFLICT (user_id, asset) DO NOTHING;

    -- Ensure in user_wallets table
    INSERT INTO public.user_wallets (user_id, asset_symbol, available_balance, locked_balance, balance, updated_at)
    VALUES (p_user_id, UPPER(p_asset), 0.00000000, 0.00000000, 0.00000000, NOW())
    ON CONFLICT DO NOTHING;

    -- Ensure in wallet_assets table
    INSERT INTO public.wallet_assets (user_id, asset_symbol, available, locked_escrow, locked_balance, updated_at)
    VALUES (p_user_id, UPPER(p_asset), 0.00000000, 0.00000000, 0.00000000, NOW())
    ON CONFLICT DO NOTHING;
END;
$$;

-- 2. Atomic Escrow Locking Procedure (locks crypto_amount + 1.5% escrow fee from seller)
CREATE OR REPLACE FUNCTION public.lock_seller_escrow(
    p_seller_id UUID,
    p_asset TEXT,
    p_crypto_amount NUMERIC(28, 8),
    p_escrow_fee NUMERIC(28, 8) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_asset TEXT := UPPER(p_asset);
    v_fee NUMERIC(28, 8);
    v_total_lock NUMERIC(28, 8);
    v_current_avail NUMERIC(28, 8) := 0;
    v_found BOOLEAN := FALSE;
BEGIN
    IF p_crypto_amount <= 0 THEN
        RAISE EXCEPTION 'Crypto amount must be greater than zero.';
    END IF;

    -- Calculate 1.5% fee if not provided
    IF p_escrow_fee IS NULL OR p_escrow_fee < 0 THEN
        v_fee := ROUND(p_crypto_amount * 0.015, 8);
    ELSE
        v_fee := p_escrow_fee;
    END IF;

    v_total_lock := p_crypto_amount + v_fee;

    -- Ensure records exist
    PERFORM public.ensure_user_balance_wallet(p_seller_id, v_asset);

    -- 1. Check & Lock balances table row
    SELECT available_balance INTO v_current_avail
    FROM public.balances
    WHERE user_id = p_seller_id AND UPPER(asset) = v_asset
    FOR UPDATE;

    IF v_current_avail IS NOT NULL THEN
        v_found := TRUE;
    ELSE
        -- Fallback to user_balances
        SELECT available_balance INTO v_current_avail
        FROM public.user_balances
        WHERE user_id = p_seller_id AND UPPER(asset) = v_asset
        FOR UPDATE;
        IF v_current_avail IS NOT NULL THEN v_found := TRUE; END IF;
    END IF;

    IF NOT v_found OR v_current_avail < v_total_lock THEN
        -- Check user_wallets / wallet_assets as secondary check
        SELECT COALESCE(available_balance, balance, 0) INTO v_current_avail
        FROM public.user_wallets
        WHERE user_id = p_seller_id AND UPPER(asset_symbol) = v_asset
        FOR UPDATE;
    END IF;

    IF v_current_avail IS NULL OR v_current_avail < v_total_lock THEN
        RAISE EXCEPTION 'Insufficient available balance. Required: % % (including % % escrow fee), Available: % %',
            v_total_lock, v_asset, v_fee, v_asset, COALESCE(v_current_avail, 0), v_asset;
    END IF;

    -- Execute Atomic Lock across all balance tables
    -- Table: balances
    UPDATE public.balances
    SET 
        available_balance = GREATEST(0, available_balance - v_total_lock),
        locked_balance = locked_balance + v_total_lock,
        updated_at = NOW()
    WHERE user_id = p_seller_id AND UPPER(asset) = v_asset;

    -- Table: user_balances
    UPDATE public.user_balances
    SET 
        available_balance = GREATEST(0, available_balance - v_total_lock),
        locked_balance = locked_balance + v_total_lock,
        updated_at = NOW()
    WHERE user_id = p_seller_id AND UPPER(asset) = v_asset;

    -- Table: user_wallets
    UPDATE public.user_wallets
    SET 
        available_balance = GREATEST(0, COALESCE(available_balance, balance) - v_total_lock),
        locked_balance = COALESCE(locked_balance, 0) + v_total_lock,
        updated_at = NOW()
    WHERE user_id = p_seller_id AND UPPER(asset_symbol) = v_asset;

    -- Table: wallet_assets
    UPDATE public.wallet_assets
    SET 
        available = GREATEST(0, COALESCE(available, balance) - v_total_lock),
        locked_escrow = COALESCE(locked_escrow, locked_balance, 0) + v_total_lock,
        locked_balance = COALESCE(locked_balance, 0) + v_total_lock,
        updated_at = NOW()
    WHERE user_id = p_seller_id AND UPPER(asset_symbol) = v_asset;

    -- Table: wallets
    UPDATE public.wallets
    SET 
        locked_balance = COALESCE(locked_balance, 0) + v_total_lock,
        updated_at = NOW()
    WHERE user_id = p_seller_id AND UPPER(currency) = v_asset;

    RETURN jsonb_build_object(
        'success', true,
        'seller_id', p_seller_id,
        'asset', v_asset,
        'crypto_amount', p_crypto_amount,
        'escrow_fee', v_fee,
        'total_locked', v_total_lock,
        'message', 'Escrow funds successfully locked from seller available balance.'
    );
END;
$$;

-- 3. Atomic Escrow Release Procedure (releases crypto to buyer, deducts fee from seller)
CREATE OR REPLACE FUNCTION public.release_trade_escrow(
    p_trade_id TEXT,
    p_seller_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trade RECORD;
    v_asset TEXT;
    v_crypto_amt NUMERIC(28, 8);
    v_fee_amt NUMERIC(28, 8);
    v_total_seller_deduct NUMERIC(28, 8);
    v_is_uuid BOOLEAN;
BEGIN
    v_is_uuid := p_trade_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    -- Fetch trade row with row lock
    IF v_is_uuid THEN
        SELECT * INTO v_trade
        FROM public.trades
        WHERE (id = p_trade_id::uuid OR trade_id = p_trade_id)
        FOR UPDATE;
    ELSE
        SELECT * INTO v_trade
        FROM public.trades
        WHERE trade_id = p_trade_id
        FOR UPDATE;
    END IF;

    IF v_trade.id IS NULL THEN
        RAISE EXCEPTION 'Trade not found: %', p_trade_id;
    END IF;

    -- Verify caller is seller
    IF v_trade.seller_id::text != p_seller_id::text THEN
        RAISE EXCEPTION 'Unauthorized: Only the seller can release escrow.';
    END IF;

    -- Verify releaseable status: must be marked paid OR in dispute
    IF v_trade.status NOT IN ('paid', 'PAID', 'buyer_marked_paid', 'payment_sent', 'disputed', 'DISPUTED') 
       AND v_trade.paid_at IS NULL 
       AND v_trade.escrow_status NOT IN ('PAID', 'DISPUTED') THEN
        RAISE EXCEPTION 'Cannot release escrow before buyer marks trade as paid or while trade is in unconfirmed state.';
    END IF;

    IF v_trade.status IN ('completed', 'released', 'COMPLETED', 'RELEASED') THEN
        RAISE EXCEPTION 'Trade has already been released and completed.';
    END IF;

    IF v_trade.status IN ('cancelled', 'expired', 'CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'Cannot release escrow for a cancelled or expired trade.';
    END IF;

    v_asset := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, v_trade.coin, 'USDT'));
    v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
    v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.platform_fee, ROUND(v_crypto_amt * 0.015, 8));
    v_total_seller_deduct := v_crypto_amt + v_fee_amt;

    -- Ensure buyer balances exist
    PERFORM public.ensure_user_balance_wallet(v_trade.buyer_id::uuid, v_asset);

    -- 1. Deduct seller locked balance & total balance
    UPDATE public.balances
    SET 
        locked_balance = GREATEST(0, locked_balance - v_total_seller_deduct),
        total_balance = GREATEST(0, total_balance - v_total_seller_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset) = v_asset;

    UPDATE public.user_balances
    SET 
        locked_balance = GREATEST(0, locked_balance - v_total_seller_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset) = v_asset;

    UPDATE public.user_wallets
    SET 
        locked_balance = GREATEST(0, locked_balance - v_total_seller_deduct),
        balance = GREATEST(0, balance - v_total_seller_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset_symbol) = v_asset;

    UPDATE public.wallet_assets
    SET 
        locked_escrow = GREATEST(0, COALESCE(locked_escrow, locked_balance, 0) - v_total_seller_deduct),
        locked_balance = GREATEST(0, locked_balance - v_total_seller_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset_symbol) = v_asset;

    UPDATE public.wallets
    SET 
        locked_balance = GREATEST(0, locked_balance - v_total_seller_deduct),
        total_balance = GREATEST(0, total_balance - v_total_seller_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id::uuid AND UPPER(currency) = v_asset;

    -- 2. Credit buyer available balance
    UPDATE public.balances
    SET 
        available_balance = available_balance + v_crypto_amt,
        total_balance = total_balance + v_crypto_amt,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id::uuid AND UPPER(asset) = v_asset;

    UPDATE public.user_balances
    SET 
        available_balance = available_balance + v_crypto_amt,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id::uuid AND UPPER(asset) = v_asset;

    UPDATE public.user_wallets
    SET 
        available_balance = COALESCE(available_balance, balance, 0) + v_crypto_amt,
        balance = balance + v_crypto_amt,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id::uuid AND UPPER(asset_symbol) = v_asset;

    UPDATE public.wallet_assets
    SET 
        available = COALESCE(available, balance, 0) + v_crypto_amt,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id::uuid AND UPPER(asset_symbol) = v_asset;

    UPDATE public.wallets
    SET 
        total_balance = total_balance + v_crypto_amt,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id::uuid AND UPPER(currency) = v_asset;

    -- 3. Mark trade released & completed
    UPDATE public.trades
    SET 
        status = 'released',
        escrow_status = 'RELEASED',
        released_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_trade.id;

    -- Increment completed trades in profiles
    UPDATE public.profiles
    SET completed_trades = COALESCE(completed_trades, 0) + 1
    WHERE id IN (v_trade.buyer_id::uuid, v_trade.seller_id::uuid);

    -- Close dispute if active
    UPDATE public.disputes
    SET 
        status = 'RESOLVED',
        admin_decision = 'RELEASE_BUYER',
        resolved_at = NOW()
    WHERE trade_id = v_trade.id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', v_trade.id,
        'buyer_id', v_trade.buyer_id,
        'crypto_credited', v_crypto_amt,
        'escrow_fee_deducted', v_fee_amt,
        'status', 'released'
    );
END;
$$;

-- 4. Atomic Trade Cancellation Procedure (unlocks locked crypto & fee back to seller)
CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
    p_trade_id TEXT,
    p_user_id UUID,
    p_reason TEXT DEFAULT 'Cancelled by user'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trade RECORD;
    v_asset TEXT;
    v_crypto_amt NUMERIC(28, 8);
    v_fee_amt NUMERIC(28, 8);
    v_total_refund NUMERIC(28, 8);
    v_is_uuid BOOLEAN;
BEGIN
    v_is_uuid := p_trade_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    IF v_is_uuid THEN
        SELECT * INTO v_trade
        FROM public.trades
        WHERE (id = p_trade_id::uuid OR trade_id = p_trade_id)
        FOR UPDATE;
    ELSE
        SELECT * INTO v_trade
        FROM public.trades
        WHERE trade_id = p_trade_id
        FOR UPDATE;
    END IF;

    IF v_trade.id IS NULL THEN
        RAISE EXCEPTION 'Trade not found: %', p_trade_id;
    END IF;

    -- Ensure caller is buyer or seller
    IF v_trade.buyer_id::text != p_user_id::text AND v_trade.seller_id::text != p_user_id::text THEN
        RAISE EXCEPTION 'Unauthorized: Only participants can cancel this trade.';
    END IF;

    IF v_trade.status IN ('completed', 'released', 'COMPLETED', 'RELEASED') THEN
        RAISE EXCEPTION 'Cannot cancel a completed or released trade.';
    END IF;

    IF v_trade.status IN ('cancelled', 'expired', 'CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'Trade is already cancelled or expired.';
    END IF;

    v_asset := UPPER(COALESCE(v_trade.crypto, v_trade.asset_symbol, v_trade.coin, 'USDT'));
    v_crypto_amt := COALESCE(v_trade.crypto_amount, v_trade.amount, 0);
    v_fee_amt := COALESCE(v_trade.escrow_fee, v_trade.platform_fee, ROUND(v_crypto_amt * 0.015, 8));
    v_total_refund := v_crypto_amt + v_fee_amt;

    -- Refund locked funds back to seller available balance
    IF v_trade.seller_id IS NOT NULL AND v_total_refund > 0 THEN
        UPDATE public.balances
        SET 
            available_balance = available_balance + v_total_refund,
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset) = v_asset;

        UPDATE public.user_balances
        SET 
            available_balance = available_balance + v_total_refund,
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset) = v_asset;

        UPDATE public.user_wallets
        SET 
            available_balance = COALESCE(available_balance, balance, 0) + v_total_refund,
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset_symbol) = v_asset;

        UPDATE public.wallet_assets
        SET 
            available = COALESCE(available, balance, 0) + v_total_refund,
            locked_escrow = GREATEST(0, COALESCE(locked_escrow, locked_balance, 0) - v_total_refund),
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id::uuid AND UPPER(asset_symbol) = v_asset;

        UPDATE public.wallets
        SET 
            locked_balance = GREATEST(0, locked_balance - v_total_refund),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id::uuid AND UPPER(currency) = v_asset;
    END IF;

    -- Mark trade as cancelled
    UPDATE public.trades
    SET 
        status = 'cancelled',
        escrow_status = 'CANCELLED',
        cancelled_at = NOW(),
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = v_trade.id;

    -- If dispute exists, mark closed/cancelled
    UPDATE public.disputes
    SET 
        status = 'CLOSED',
        admin_decision = 'REFUND_SELLER',
        resolved_at = NOW()
    WHERE trade_id = v_trade.id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', v_trade.id,
        'refunded_seller_id', v_trade.seller_id,
        'total_refunded', v_total_refund,
        'status', 'cancelled'
    );
END;
$$;
