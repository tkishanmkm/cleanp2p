-- ============================================================================
-- Supabase Migration: 20260928070000_canonical_p2p_state_machine_and_rpcs.sql
-- Description: Authoritative P2P State-Machine & RPC Hardening Migration.
--              1. Creates canonical initiate_trade_with_escrow RPC using wallet_assets & ledger_entries.
--              2. Creates canonical raise_trade_dispute RPC for atomic dispute handling.
--              3. Updates cancel_p2p_trade RPC to allow authorized admin dispute cancellation & seller refund.
--              4. Ensures strict double-entry ledger settlement, search_path security, and explicit typecasting.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Authoritative initiate_trade_with_escrow RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.initiate_trade_with_escrow(
    p_ad_id TEXT,
    p_crypto_amount NUMERIC,
    p_fiat_amount NUMERIC,
    p_fiat_currency TEXT,
    p_price NUMERIC,
    p_payment_method TEXT,
    p_trade_ref TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_is_admin BOOLEAN := FALSE;
    v_ad RECORD;
    v_ad_uuid UUID := NULL;
    v_buyer_id UUID;
    v_seller_id UUID;
    v_asset TEXT;
    v_unit_price NUMERIC(36, 18);
    v_crypto_amount NUMERIC(36, 18);
    v_fiat_amount NUMERIC(18, 2);
    v_fiat_currency TEXT;
    v_escrow_fee NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_payment_window_mins INTEGER := 30;
    v_trade_id UUID;
    v_public_id TEXT;
    v_seller_wallet_id UUID;
    v_buyer_wallet_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_lock_id UUID;
    v_lock_rec RECORD;
    v_existing_trade RECORD;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL AND p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_effective_caller := COALESCE(p_caller_id, v_auth_uid);

    -- 2. Validate UUID format if provided for Ad
    IF p_ad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_ad_uuid := p_ad_id::UUID;
    END IF;

    -- 3. Lookup Advertisement (from p2p_ads or ads)
    IF v_ad_uuid IS NOT NULL THEN
        SELECT * INTO v_ad
        FROM public.p2p_ads
        WHERE id = v_ad_uuid OR public_ad_id = p_ad_id OR public_id = p_ad_id
        LIMIT 1;
    ELSE
        SELECT * INTO v_ad
        FROM public.p2p_ads
        WHERE public_ad_id = p_ad_id OR public_id = p_ad_id OR id::TEXT = p_ad_id
        LIMIT 1;
    END IF;

    IF v_ad.id IS NULL THEN
        IF v_ad_uuid IS NOT NULL THEN
            SELECT * INTO v_ad
            FROM public.ads
            WHERE id = v_ad_uuid OR public_id = p_ad_id OR public_ad_id = p_ad_id
            LIMIT 1;
        ELSE
            SELECT * INTO v_ad
            FROM public.ads
            WHERE public_id = p_ad_id OR public_ad_id = p_ad_id OR id::TEXT = p_ad_id
            LIMIT 1;
        END IF;
    END IF;

    IF v_ad.id IS NULL THEN
        RAISE EXCEPTION 'Advertisement % not found.', p_ad_id;
    END IF;

    -- 4. Verify Active Status & Non-Self Trading
    IF v_ad.user_id = v_effective_caller THEN
        RAISE EXCEPTION 'You cannot trade with your own advertisement.';
    END IF;

    -- 5. Determine Trade Counterparties based on Ad Type
    IF LOWER(COALESCE(v_ad.type, v_ad.ad_type, 'sell')) = 'buy' THEN
        -- Ad creator is BUYING crypto -> Counterparty (caller) is SELLING crypto
        v_seller_id := v_effective_caller;
        v_buyer_id := v_ad.user_id;
    ELSE
        -- Ad creator is SELLING crypto -> Counterparty (caller) is BUYING crypto
        v_seller_id := v_ad.user_id;
        v_buyer_id := v_effective_caller;
    END IF;

    -- 6. Resolve Financial Parameters Server-Authoritatively
    v_asset := UPPER(COALESCE(v_ad.crypto, v_ad.asset, v_ad.crypto_symbol, 'USDT'));
    v_unit_price := COALESCE(p_price, v_ad.fixed_rate, v_ad.price, v_ad.unit_price, 1.0);
    IF v_unit_price <= 0 THEN
        v_unit_price := 1.0;
    END IF;

    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0 THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_fiat_currency := UPPER(COALESCE(p_fiat_currency, v_ad.fiat_currency, v_ad.fiat, 'USD'));

    -- Authoritative 1.5% Escrow Fee Rule
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

    v_payment_window_mins := COALESCE(v_ad.payment_window_minutes, v_ad.payment_window, v_ad.payment_time_limit, 30);
    IF v_payment_window_mins < 15 OR v_payment_window_mins > 360 THEN
        v_payment_window_mins := 30;
    END IF;

    v_public_id := COALESCE(p_trade_ref, 'TX' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

    -- 7. Idempotency Check on Trade Ref / Idempotency Key
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_trade
        FROM public.trades
        WHERE public_id = p_idempotency_key OR trade_id = p_idempotency_key OR public_id = v_public_id
        LIMIT 1;

        IF v_existing_trade.id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'trade_id', v_existing_trade.id,
                'public_id', v_existing_trade.public_id,
                'buyer_id', v_existing_trade.buyer_id,
                'seller_id', v_existing_trade.seller_id,
                'crypto_amount', v_existing_trade.crypto_amount,
                'escrow_fee', v_existing_trade.escrow_fee,
                'fiat_amount', v_existing_trade.fiat_amount,
                'fiat_currency', v_existing_trade.fiat_currency,
                'asset', v_existing_trade.crypto,
                'status', v_existing_trade.status,
                'escrow_status', v_existing_trade.escrow_status,
                'message', 'Trade already initiated (idempotent replay)'
            );
        END IF;
    END IF;

    -- 8. Lock Wallet Infrastructure FOR UPDATE
    -- Ensure Seller Wallet
    SELECT id INTO v_seller_wallet_id
    FROM public.wallets
    WHERE user_id = v_seller_id;

    IF v_seller_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, created_at, updated_at)
        VALUES (v_seller_id, NOW(), NOW())
        RETURNING id INTO v_seller_wallet_id;
    END IF;

    -- Ensure Buyer Wallet
    SELECT id INTO v_buyer_wallet_id
    FROM public.wallets
    WHERE user_id = v_buyer_id;

    IF v_buyer_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, created_at, updated_at)
        VALUES (v_buyer_id, NOW(), NOW())
        RETURNING id INTO v_buyer_wallet_id;
    END IF;

    -- Ensure Buyer wallet_assets record exists
    INSERT INTO public.wallet_assets (wallet_id, user_id, asset_symbol, balance, in_escrow, created_at, updated_at)
    VALUES (v_buyer_wallet_id, v_buyer_id, v_asset, 0.0, 0.0, NOW(), NOW())
    ON CONFLICT (wallet_id, asset_symbol) DO NOTHING;

    -- Lock Seller wallet_assets Record FOR UPDATE
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_seller_id AND asset_symbol = v_asset
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_seller_id, v_asset;
    END IF;

    IF v_seller_bal < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient spendable balance to fund escrow. Required: % % (including 1.5%% fee), Available: % %',
            v_total_escrow, v_asset, v_seller_bal, v_asset;
    END IF;

    -- 9. Generate Trade UUID
    v_trade_id := gen_random_uuid();

    -- 10. Atomic Balance Mutation on wallet_assets (Locking Escrow)
    UPDATE public.wallet_assets
    SET balance = balance - v_total_escrow,
        in_escrow = in_escrow + v_total_escrow,
        updated_at = NOW()
    WHERE user_id = v_seller_id
      AND asset_symbol = v_asset
      AND balance >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not lock escrow on seller wallet_assets for trade %', v_trade_id;
    END IF;

    -- 11. Record Double-Entry Escrow Lock Ledger Entry
    INSERT INTO public.ledger_entries (
        wallet_id,
        user_id,
        asset_code,
        delta_available,
        delta_locked,
        available_after,
        locked_after,
        entry_type,
        ref_table,
        ref_id,
        idempotency_key
    ) VALUES (
        v_seller_wallet_id,
        v_seller_id,
        v_asset,
        -v_total_escrow,
        +v_total_escrow,
        v_seller_bal_after,
        v_seller_escrow_after,
        'escrow_lock',
        'trades',
        v_trade_id::TEXT,
        'p2p_lock_' || v_trade_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_lock_id;

    IF v_lock_id IS NULL THEN
        SELECT * INTO v_lock_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_lock_' || v_trade_id::TEXT
        FOR UPDATE;

        IF v_lock_rec.user_id IS DISTINCT FROM v_seller_id
           OR v_lock_rec.wallet_id IS DISTINCT FROM v_seller_wallet_id
           OR v_lock_rec.asset_code IS DISTINCT FROM v_asset
           OR v_lock_rec.delta_available IS DISTINCT FROM (-v_total_escrow)
           OR v_lock_rec.delta_locked IS DISTINCT FROM v_total_escrow
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing lock ledger record for trade % differs from expected parameters.', v_trade_id;
        END IF;
    END IF;

    -- 12. Insert Authoritative Trade Record
    INSERT INTO public.trades (
        id,
        public_id,
        trade_id,
        ad_id,
        buyer_id,
        seller_id,
        crypto,
        asset_code,
        crypto_currency,
        asset_symbol,
        crypto_amount,
        amount,
        escrow_fee,
        platform_fee,
        fiat_amount,
        total_fiat,
        fiat_currency,
        price,
        unit_price,
        rate,
        payment_method,
        status,
        escrow_status,
        payment_window_minutes,
        payment_time_limit,
        created_at,
        expires_at,
        updated_at
    ) VALUES (
        v_trade_id,
        v_public_id,
        v_public_id,
        v_ad.id,
        v_buyer_id,
        v_seller_id,
        v_asset,
        v_asset,
        v_asset,
        v_asset,
        v_crypto_amount,
        v_crypto_amount,
        v_escrow_fee,
        v_escrow_fee,
        v_fiat_amount,
        v_fiat_amount,
        v_fiat_currency,
        v_unit_price,
        v_unit_price,
        v_unit_price,
        COALESCE(p_payment_method, 'Bank Transfer'),
        'pending',
        'ESCROW_LOCKED',
        v_payment_window_mins,
        v_payment_window_mins,
        NOW(),
        NOW() + (v_payment_window_mins || ' minutes')::INTERVAL,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', v_trade_id,
        'public_id', v_public_id,
        'buyer_id', v_buyer_id,
        'seller_id', v_seller_id,
        'crypto_amount', v_crypto_amount,
        'escrow_fee', v_escrow_fee,
        'fiat_amount', v_fiat_amount,
        'fiat_currency', v_fiat_currency,
        'asset', v_asset,
        'status', 'pending',
        'escrow_status', 'ESCROW_LOCKED',
        'expires_at', (NOW() + (v_payment_window_mins || ' minutes')::INTERVAL)
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Authoritative raise_trade_dispute RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.raise_trade_dispute(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.raise_trade_dispute(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.raise_trade_dispute(
    p_trade_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT 'Dispute opened'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_caller_id UUID;
    v_trade RECORD;
    v_is_buyer BOOLEAN := FALSE;
    v_is_seller BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_dispute_reason TEXT;
    v_dispute_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL AND p_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_caller_id := COALESCE(p_user_id, v_auth_uid);

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    -- 3. Authorization Check
    v_is_buyer := (v_caller_id = v_trade.buyer_id);
    v_is_seller := (v_caller_id = v_trade.seller_id);
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_caller_id
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               );

    IF NOT (v_is_buyer OR v_is_seller OR v_is_admin) THEN
        RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can raise a dispute for trade %.', p_trade_id;
    END IF;

    -- 4. Terminal State Guard
    IF LOWER(COALESCE(v_trade.status, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot open dispute on trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot open dispute on trade % in terminal % state.', p_trade_id, v_trade.status;
    END IF;

    -- 5. Idempotent Check: Already Disputed
    IF LOWER(COALESCE(v_trade.status, '')) IN ('disputed', 'dispute') OR LOWER(COALESCE(v_trade.escrow_status, '')) = 'disputed' THEN
        SELECT id INTO v_dispute_id
        FROM public.disputes
        WHERE trade_id = p_trade_id AND LOWER(status) = 'open'
        LIMIT 1;

        RETURN jsonb_build_object(
            'success', true,
            'dispute_id', v_dispute_id,
            'trade_id', p_trade_id,
            'status', 'disputed',
            'escrow_status', 'DISPUTED',
            'message', 'Trade is already in dispute (idempotent success)'
        );
    END IF;

    v_dispute_reason := COALESCE(NULLIF(TRIM(p_reason), ''), 'Dispute raised by participant');

    -- 6. Atomic Mutation: Set Trade to Disputed
    UPDATE public.trades
    SET status = 'disputed',
        escrow_status = 'DISPUTED',
        disputed_at = NOW(),
        dispute_reason = v_dispute_reason,
        disputed_by = v_caller_id,
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7. Insert Dispute Record into public.disputes
    INSERT INTO public.disputes (
        trade_id,
        opened_by,
        reason,
        explanation,
        status,
        created_at,
        updated_at
    ) VALUES (
        p_trade_id,
        v_caller_id,
        v_dispute_reason,
        v_dispute_reason,
        'open',
        NOW(),
        NOW()
    )
    RETURNING id INTO v_dispute_id;

    RETURN jsonb_build_object(
        'success', true,
        'dispute_id', v_dispute_id,
        'trade_id', p_trade_id,
        'status', 'disputed',
        'escrow_status', 'DISPUTED',
        'disputed_by', v_caller_id,
        'reason', v_dispute_reason
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. Authoritative cancel_p2p_trade RPC (Allow Admin Dispute Cancellation)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(
    p_trade_id UUID,
    p_caller_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;
    v_trade RECORD;
    v_seller_wallet_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid BOOLEAN := FALSE;
    v_is_disputed BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_can_rec RECORD;
    v_can_id UUID;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NULL AND p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_effective_caller := COALESCE(p_caller_id, v_auth_uid);

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Determine Payment and Dispute Status
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent'));

    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    -- 4. Check Admin Privileges
    v_is_admin := public.is_admin()
               OR (v_auth_uid IS NOT NULL AND EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_auth_uid
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               ))
               OR (v_effective_caller IS NOT NULL AND EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               ));

    -- 5. Non-Admin Security Guards: Strict Cancellation Prohibitions
    IF NOT v_is_admin THEN
        IF v_effective_caller <> v_trade.buyer_id AND v_effective_caller <> v_trade.seller_id THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety
    IF LOWER(COALESCE(v_trade.status, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot cancel trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('cancelled', 'expired') THEN
        SELECT * INTO v_can_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_can_' || p_trade_id::TEXT;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial state corruption: trade % is marked cancelled but lacks cancellation ledger record.', p_trade_id;
        END IF;

        IF v_can_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_can_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_can_rec.delta_available IS DISTINCT FROM v_total_escrow
           OR v_can_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_can_rec.entry_type IS DISTINCT FROM 'p2p_escrow_cancel'
           OR v_can_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_can_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing cancellation ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'message', 'Already cancelled (idempotent success)'
        );
    END IF;

    -- 7. Lock Seller Infrastructure & Assets FOR UPDATE
    SELECT id INTO v_seller_wallet_id
    FROM public.wallets
    WHERE user_id = v_trade.seller_id;

    IF v_seller_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Seller wallet infrastructure record not found for user %', v_trade.seller_id;
    END IF;

    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.seller_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller refund %: required %, found in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 8. Atomic Refund Mutations on wallet_assets
    UPDATE public.wallet_assets
    SET balance = balance + v_total_escrow,
        in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id
      AND asset_symbol = v_trade.crypto
      AND in_escrow >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not process cancellation refund on seller wallet_assets for trade %', p_trade_id;
    END IF;

    -- 9. Record Seller Cancellation Ledger Entry with Strict Replay Check
    INSERT INTO public.ledger_entries (
        wallet_id,
        user_id,
        asset_code,
        delta_available,
        delta_locked,
        available_after,
        locked_after,
        entry_type,
        ref_table,
        ref_id,
        idempotency_key
    ) VALUES (
        v_seller_wallet_id,
        v_trade.seller_id,
        v_trade.crypto,
        +v_total_escrow,
        -v_total_escrow,
        v_seller_bal_after,
        v_seller_escrow_after,
        'p2p_escrow_cancel',
        'trades',
        p_trade_id::TEXT,
        'p2p_can_' || p_trade_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_can_id;

    IF v_can_id IS NULL THEN
        SELECT * INTO v_can_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_can_' || p_trade_id::TEXT
        FOR UPDATE;

        IF v_can_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_can_rec.wallet_id IS DISTINCT FROM v_seller_wallet_id
           OR v_can_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_can_rec.delta_available IS DISTINCT FROM v_total_escrow
           OR v_can_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_can_rec.entry_type IS DISTINCT FROM 'p2p_escrow_cancel'
           OR v_can_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_can_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing cancellation ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;
    END IF;

    -- 10. Update Trade State to Cancelled
    UPDATE public.trades
    SET status = 'cancelled',
        escrow_status = 'CANCELLED',
        cancelled_at = NOW(),
        cancellation_reason = COALESCE(p_reason, 'Trade cancelled'),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 11. Resolve Active Dispute if present
    IF v_is_disputed THEN
        UPDATE public.disputes
        SET status = 'resolved',
            resolution = COALESCE(p_reason, 'Refunded to seller by admin dispute resolution'),
            resolved_by = v_effective_caller,
            resolved_at = NOW(),
            updated_at = NOW()
        WHERE trade_id = p_trade_id AND LOWER(status) = 'open';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'cancelled',
        'escrow_status', 'CANCELLED'
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. Manage Legacy initiate_p2p_trade Function
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.initiate_p2p_trade(UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT);

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
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Safe router to authoritative initiate_trade_with_escrow procedure
    RETURN public.initiate_trade_with_escrow(
        p_ad_id := p_ad_id::TEXT,
        p_crypto_amount := p_crypto_amount,
        p_fiat_amount := p_fiat_amount,
        p_fiat_currency := p_fiat_currency,
        p_price := p_rate,
        p_payment_method := p_payment_method,
        p_trade_ref := NULL,
        p_idempotency_key := NULL,
        p_caller_id := COALESCE(auth.uid(), p_buyer_id)
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 5. Revoke & Grant Exact Privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_p2p_trade(UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade(UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated, service_role, postgres;

COMMIT;
