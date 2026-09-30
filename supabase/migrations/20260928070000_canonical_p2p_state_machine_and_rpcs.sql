-- ============================================================================
-- Supabase Migration: 20260928070000_canonical_p2p_state_machine_and_rpcs.sql
-- Description: Authoritative P2P State-Machine & Escrow Lifecycle RPCs
--              Aligned strictly with LIVE schema:
--              1. public.wallet_assets (user_id, asset_symbol) balance & in_escrow
--              2. public.ledger_entries (user_id, crypto, asset, amount, type='transfer',
--                 reference_id, balance_after, metadata, status='completed')
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

    -- Strongly-typed record variables for each relation
    v_p2p_ad public.p2p_ads%ROWTYPE;
    v_legacy_ad public.ads%ROWTYPE;

    -- Normalized scalar variables
    v_found_ad BOOLEAN := FALSE;
    v_ad_id UUID := NULL;
    v_ad_user_id UUID := NULL;
    v_ad_type TEXT := 'SELL';
    v_ad_asset TEXT := 'USDT';
    v_ad_price NUMERIC(36, 18) := 1.0;
    v_ad_fiat_currency TEXT := 'USD';
    v_ad_payment_window_mins INTEGER := 30;
    v_ad_is_active BOOLEAN := TRUE;
    v_ad_source TEXT := NULL;

    -- Counterparties & Financials
    v_buyer_id UUID;
    v_seller_id UUID;
    v_unit_price NUMERIC(36, 18);
    v_crypto_amount NUMERIC(36, 18);
    v_fiat_amount NUMERIC(18, 2);
    v_fiat_currency TEXT;
    v_escrow_fee NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);

    -- Identifiers & Wallets
    v_trade_id UUID;
    v_public_id TEXT;
    v_trade_ad_id VARCHAR := NULL;
    v_ad_public_ad_id TEXT := NULL;
    v_seller_wallet_asset_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_existing_trade RECORD;
BEGIN
    -- 1. Strict Authentication & Authorization Enforcement
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- 2. Lookup in Canonical public.p2p_ads Table
    IF p_ad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_p2p_ad
        FROM public.p2p_ads
        WHERE id = p_ad_id::UUID
           OR public_ad_id = p_ad_id
        LIMIT 1;
    ELSE
        SELECT * INTO v_p2p_ad
        FROM public.p2p_ads
        WHERE public_ad_id = p_ad_id
           OR id::TEXT = p_ad_id
        LIMIT 1;
    END IF;

    IF v_p2p_ad.id IS NOT NULL THEN
        v_found_ad := TRUE;
        v_ad_id := v_p2p_ad.id;
        v_ad_user_id := v_p2p_ad.user_id;
        v_ad_public_ad_id := v_p2p_ad.public_ad_id;

        -- Resolve corresponding legacy public.ads.id strictly for foreign key trades_ad_id_fkey
        SELECT id INTO v_trade_ad_id
        FROM public.ads
        WHERE public_ad_id = v_p2p_ad.public_ad_id
           OR id = v_p2p_ad.id::TEXT
        LIMIT 1;

        v_ad_type := UPPER(COALESCE(
            v_p2p_ad.ad_type,
            v_p2p_ad.type,
            'SELL'
        ));

        v_ad_asset := UPPER(COALESCE(
            v_p2p_ad.asset_symbol,
            v_p2p_ad.crypto_currency,
            v_p2p_ad.coin,
            'USDT'
        ));

        v_ad_price := COALESCE(
            NULLIF(p_price, 0),
            v_p2p_ad.price,
            1.0
        );

        v_ad_fiat_currency := UPPER(COALESCE(
            NULLIF(p_fiat_currency, ''),
            v_p2p_ad.fiat_currency,
            v_p2p_ad.fiat_symbol,
            'USD'
        ));

        v_ad_payment_window_mins := 30;

        v_ad_is_active := COALESCE(v_p2p_ad.active, TRUE)
                      AND COALESCE(v_p2p_ad.is_active, TRUE)
                      AND NOT COALESCE(v_p2p_ad.is_deleted, FALSE)
                      AND UPPER(COALESCE(v_p2p_ad.status, 'ACTIVE')) = 'ACTIVE';

        v_ad_source := 'p2p_ads';
    END IF;

    -- 3. Fallback Lookup in Legacy public.ads Table (if not found in p2p_ads)
    IF NOT v_found_ad THEN
        SELECT * INTO v_legacy_ad
        FROM public.ads
        WHERE public_id = p_ad_id
           OR public_ad_id = p_ad_id
           OR id = p_ad_id
        LIMIT 1;

        IF v_legacy_ad.id IS NOT NULL THEN
            v_found_ad := TRUE;
            v_ad_user_id := v_legacy_ad.user_id;
            v_trade_ad_id := v_legacy_ad.id;
            v_ad_public_ad_id := v_legacy_ad.public_ad_id;

            -- Resolve ad UUID strictly without fabricating synthetic IDs
            IF v_legacy_ad.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                v_ad_id := v_legacy_ad.id::UUID;
            ELSIF v_legacy_ad.public_ad_id IS NOT NULL THEN
                SELECT pa.id INTO v_ad_id
                FROM public.p2p_ads pa
                WHERE pa.public_ad_id = v_legacy_ad.public_ad_id
                LIMIT 1;
            ELSE
                v_ad_id := NULL;
            END IF;

            v_ad_type := UPPER(COALESCE(
                v_legacy_ad.type,
                'SELL'
            ));

            v_ad_asset := UPPER(COALESCE(
                v_legacy_ad.asset_symbol,
                v_legacy_ad.asset,
                v_legacy_ad.coin,
                v_legacy_ad.token_symbol,
                v_legacy_ad.crypto_currency,
                'USDT'
            ));

            v_ad_price := COALESCE(
                NULLIF(p_price, 0),
                v_legacy_ad.price,
                v_legacy_ad.unit_price,
                v_legacy_ad.fixed_rate,
                1.0
            );

            v_ad_fiat_currency := UPPER(COALESCE(
                NULLIF(p_fiat_currency, ''),
                v_legacy_ad.fiat_currency,
                v_legacy_ad.fiat_symbol,
                v_legacy_ad.currency,
                'USD'
            ));

            v_ad_payment_window_mins := COALESCE(
                v_legacy_ad.payment_window_minutes,
                v_legacy_ad.payment_window,
                v_legacy_ad.payment_time_limit,
                30
            );

            v_ad_is_active := COALESCE(v_legacy_ad.active, TRUE)
                          AND COALESCE(v_legacy_ad.is_active, TRUE)
                          AND NOT COALESCE(v_legacy_ad.is_deleted, FALSE)
                          AND UPPER(COALESCE(v_legacy_ad.status, 'ACTIVE')) = 'ACTIVE';

            v_ad_source := 'ads';
        END IF;
    END IF;

    -- 4. Active Status & Existence Checks
    IF NOT v_found_ad THEN
        RAISE EXCEPTION 'Advertisement % not found.', p_ad_id;
    END IF;

    IF NOT v_ad_is_active THEN
        RAISE EXCEPTION 'Advertisement % is currently inactive.', p_ad_id;
    END IF;

    IF v_ad_user_id = v_effective_caller THEN
        RAISE EXCEPTION 'You cannot trade with your own advertisement.';
    END IF;

    -- Bounded Payment Window
    IF v_ad_payment_window_mins < 15 OR v_ad_payment_window_mins > 360 THEN
        v_ad_payment_window_mins := 30;
    END IF;

    -- Positive Price Check
    IF v_ad_price <= 0 THEN
        v_ad_price := 1.0;
    END IF;

    -- 5. Determine Trade Counterparties based on Normalized Ad Type
    IF v_ad_type = 'BUY' THEN
        -- Ad creator is BUYING crypto -> Counterparty (caller) is SELLING crypto
        v_seller_id := v_effective_caller;
        v_buyer_id := v_ad_user_id;
    ELSE
        -- Ad creator is SELLING crypto -> Counterparty (caller) is BUYING crypto
        v_seller_id := v_ad_user_id;
        v_buyer_id := v_effective_caller;
    END IF;

    -- 6. Financial Calculations (Authoritative 1.5% Escrow Fee)
    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;

    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0 THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

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

    -- 8. Ensure Buyer wallet_assets Record Exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        in_escrow,
        created_at,
        updated_at
    )
    VALUES (
        v_buyer_id,
        v_ad_asset,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    -- Lock Seller wallet_assets Record strictly by user_id and asset_symbol FOR UPDATE
    SELECT
        id,
        balance,
        in_escrow
    INTO
        v_seller_wallet_asset_id,
        v_seller_bal,
        v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_seller_id
      AND asset_symbol = v_ad_asset
    FOR UPDATE;

    IF v_seller_wallet_asset_id IS NULL THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_seller_id, v_ad_asset;
    END IF;

    IF v_seller_bal < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient spendable balance to fund escrow. Required: % % (including 1.5%% fee), Available: % %',
            v_total_escrow, v_ad_asset, v_seller_bal, v_ad_asset;
    END IF;

    -- 9. Generate Trade UUID
    v_trade_id := gen_random_uuid();

    -- 10. Atomic Balance Mutation Pinned to the Single Selected Primary Key
    UPDATE public.wallet_assets
    SET
        balance = balance - v_total_escrow,
        in_escrow = in_escrow + v_total_escrow,
        updated_at = NOW()
    WHERE id = v_seller_wallet_asset_id
      AND balance >= v_total_escrow
    RETURNING
        balance,
        in_escrow
    INTO
        v_seller_bal_after,
        v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not lock escrow on seller wallet_assets for trade %', v_trade_id;
    END IF;

    -- 11. Record Double-Entry Escrow Lock Ledger Entry (Live Schema Compatible)
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_seller_id,
        v_ad_asset,
        v_ad_asset,
        -v_total_escrow,
        'transfer',
        'trade:' || v_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_lock',
            'trade_id', v_trade_id,
            'escrow_fee', v_escrow_fee,
            'crypto_amount', v_crypto_amount,
            'total_escrow', v_total_escrow
        ),
        'completed'
    );

    -- 12. Insert Authoritative Trade Record (Strictly Live Columns Only)
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
        crypto_amount,
        amount,
        escrow_fee,
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
        created_at,
        expires_at,
        updated_at,
        public_ad_id
    ) VALUES (
        v_trade_id,
        v_public_id,
        v_public_id,
        v_trade_ad_id,
        v_buyer_id::TEXT,
        v_seller_id::TEXT,
        v_ad_asset,
        v_ad_asset,
        v_ad_asset,
        v_crypto_amount,
        v_crypto_amount,
        v_escrow_fee,
        v_fiat_amount,
        v_fiat_amount,
        v_fiat_currency,
        v_unit_price,
        v_unit_price,
        v_unit_price,
        COALESCE(p_payment_method, 'Bank Transfer'),
        'pending'::trade_status,
        'ESCROW_LOCKED',
        v_ad_payment_window_mins,
        NOW(),
        NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL,
        NOW(),
        v_ad_public_ad_id
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
        'asset', v_ad_asset,
        'status', 'pending',
        'escrow_status', 'ESCROW_LOCKED',
        'expires_at', (NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL)
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Authoritative release_trade_escrow RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_trade_escrow(UUID, UUID);
DROP FUNCTION IF EXISTS public.release_trade_escrow(UUID);

CREATE OR REPLACE FUNCTION public.release_trade_escrow(
    p_trade_id UUID,
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
    v_trade RECORD;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_buyer_bal NUMERIC(36, 18);
    v_buyer_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_buyer_bal_after NUMERIC(36, 18);
    v_buyer_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid BOOLEAN := FALSE;
    v_is_disputed BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Lock Wallet Assets FOR UPDATE
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.seller_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    -- Ensure Buyer wallet_assets exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        in_escrow,
        created_at,
        updated_at
    )
    VALUES (
        v_trade.buyer_id,
        v_trade.crypto,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    SELECT balance, in_escrow INTO v_buyer_bal, v_buyer_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.buyer_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    -- 4. Release Payment Guard
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'));

    IF NOT v_is_paid THEN
        RAISE EXCEPTION 'Trade % cannot be released before payment is marked.', p_trade_id;
    END IF;

    -- 5. Dispute & Participant Authorization Guard
    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               );

    IF v_is_disputed THEN
        IF NOT v_is_admin THEN
            RAISE EXCEPTION 'Trade % is currently in dispute. Only an authorized admin can resolve and release escrow.', p_trade_id;
        END IF;
    ELSE
        IF v_effective_caller <> v_trade.seller_id AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Unauthorized: only the seller or an authorized admin can release escrow for trade %.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety
    IF LOWER(COALESCE(v_trade.status, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot release trade % in terminal state %.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('completed', 'released') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'message', 'Already released (idempotent success)'
        );
    END IF;

    -- 7. Atomic Financial Settlement Mutations
    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller %: required %, available in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 7a. Decrement Seller in_escrow liability
    UPDATE public.wallet_assets
    SET in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id
      AND asset_symbol = v_trade.crypto
      AND in_escrow >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not update seller wallet_assets in_escrow for trade %', p_trade_id;
    END IF;

    -- 7b. Record Seller Release Ledger Entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_trade.seller_id,
        v_trade.crypto,
        v_trade.crypto,
        0.0,
        'transfer',
        'trade_rel_seller:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_release_seller',
            'trade_id', p_trade_id,
            'released_escrow', v_total_escrow
        ),
        'completed'
    );

    -- 7c. Increment Buyer spendable balance
    UPDATE public.wallet_assets
    SET balance = balance + v_trade.crypto_amount,
        updated_at = NOW()
    WHERE user_id = v_trade.buyer_id
      AND asset_symbol = v_trade.crypto
    RETURNING balance, in_escrow INTO v_buyer_bal_after, v_buyer_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not update buyer wallet_assets balance for trade %', p_trade_id;
    END IF;

    -- 7d. Record Buyer Release Ledger Entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_trade.buyer_id,
        v_trade.crypto,
        v_trade.crypto,
        +v_trade.crypto_amount,
        'transfer',
        'trade_rel_buyer:' || p_trade_id::TEXT,
        v_buyer_bal_after,
        jsonb_build_object(
            'action', 'escrow_release_buyer',
            'trade_id', p_trade_id,
            'credited_amount', v_trade.crypto_amount
        ),
        'completed'
    );

    -- 7e. Update Trade State to Completed
    UPDATE public.trades
    SET status = 'completed',
        escrow_status = 'RELEASED',
        released_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7f. Resolve Active Dispute if present
    UPDATE public.disputes
    SET status = 'resolved'
    WHERE trade_id = p_trade_id AND LOWER(status) = 'open';

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'completed',
        'escrow_status', 'RELEASED'
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. Authoritative cancel_p2p_trade RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_p2p_trade(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.cancel_p2p_trade(UUID, TEXT);
DROP FUNCTION IF EXISTS public.cancel_p2p_trade(UUID);

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
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid BOOLEAN := FALSE;
    v_is_disputed BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

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
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'message', 'Already cancelled (idempotent success)'
        );
    END IF;

    -- 7. Lock Seller Assets FOR UPDATE
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

    -- 9. Record Seller Cancellation Ledger Entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_trade.seller_id,
        v_trade.crypto,
        v_trade.crypto,
        +v_total_escrow,
        'transfer',
        'trade_can:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_cancel_refund',
            'trade_id', p_trade_id,
            'refunded_escrow', v_total_escrow,
            'reason', p_reason
        ),
        'completed'
    );

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
-- 4. Authoritative expire_p2p_trade RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.expire_p2p_trade(UUID);

CREATE OR REPLACE FUNCTION public.expire_p2p_trade(
    p_trade_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_is_service_role BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_trade RECORD;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid_or_disputed BOOLEAN := FALSE;
BEGIN
    -- 1. Caller Privilege Guard: Restricted Exclusively to System/Admin Processes
    v_is_service_role := (v_auth_uid IS NULL)
                      OR current_setting('role', true) = 'service_role'
                      OR (SELECT current_user) IN ('postgres', 'service_role');

    IF v_auth_uid IS NOT NULL THEN
        v_is_admin := public.is_admin()
                   OR EXISTS (
                       SELECT 1 FROM auth.users
                       WHERE id = v_auth_uid
                         AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
                   );
    END IF;

    IF NOT v_is_service_role AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: expire_p2p_trade is restricted strictly to backend system callers or authorized admins.';
    END IF;

    -- 2. Lock Trade Row FOR UPDATE
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found', p_trade_id;
    END IF;

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Verify Expiration Condition
    IF v_trade.expires_at IS NULL OR v_trade.expires_at > NOW() THEN
        RAISE EXCEPTION 'Trade % has not reached expiration time (expires_at: %)', p_trade_id, v_trade.expires_at;
    END IF;

    -- 4. PAID / DISPUTED GUARD: Prohibit Expiration & Refund
    v_is_paid_or_disputed := (v_trade.paid_at IS NOT NULL)
                          OR (v_trade.marked_paid_at IS NOT NULL)
                          OR (LOWER(COALESCE(v_trade.escrow_status, '')) IN ('paid', 'disputed'))
                          OR (LOWER(COALESCE(v_trade.status, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'))
                          OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    IF v_is_paid_or_disputed THEN
        RETURN jsonb_build_object(
            'success', false,
            'trade_id', p_trade_id,
            'reason', 'Cannot expire trade in paid or disputed state'
        );
    END IF;

    -- 5. Terminal State & Replay Safety
    IF LOWER(COALESCE(v_trade.status, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot expire trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status, '')) IN ('expired', 'cancelled') OR LOWER(COALESCE(v_trade.escrow_status, '')) IN ('expired', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'message', 'Already expired (idempotent success)'
        );
    END IF;

    -- 6. Lock Seller Assets FOR UPDATE
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.seller_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller expiration refund %: required %, found in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 7. Atomic Expiration Refund Mutations
    UPDATE public.wallet_assets
    SET balance = balance + v_total_escrow,
        in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id
      AND asset_symbol = v_trade.crypto
      AND in_escrow >= v_total_escrow
    RETURNING balance, in_escrow INTO v_seller_bal_after, v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not process expiration refund on seller wallet_assets for trade %', p_trade_id;
    END IF;

    -- 8. Record Seller Expiration Refund Ledger Entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_trade.seller_id,
        v_trade.crypto,
        v_trade.crypto,
        +v_total_escrow,
        'transfer',
        'trade_exp:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_expire_refund',
            'trade_id', p_trade_id,
            'refunded_escrow', v_total_escrow
        ),
        'completed'
    );

    -- 9. Update Trade State to Expired
    UPDATE public.trades
    SET status = 'expired',
        escrow_status = 'EXPIRED',
        cancellation_reason = 'Trade expired automatically',
        updated_at = NOW()
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'expired',
        'escrow_status', 'EXPIRED'
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 5. Authoritative cancel_expired_p2p_trades Batch Worker RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_expired_p2p_trades();

CREATE OR REPLACE FUNCTION public.cancel_expired_p2p_trades()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_is_service_role BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_rec RECORD;
    v_res JSONB;
    v_processed INTEGER := 0;
    v_skipped INTEGER := 0;
    v_failed INTEGER := 0;
BEGIN
    -- 1. Caller Privilege Guard: Backend Worker Only
    v_is_service_role := (v_auth_uid IS NULL)
                      OR current_setting('role', true) = 'service_role'
                      OR (SELECT current_user) IN ('postgres', 'service_role');

    IF v_auth_uid IS NOT NULL THEN
        v_is_admin := public.is_admin()
                   OR EXISTS (
                       SELECT 1 FROM auth.users
                       WHERE id = v_auth_uid
                         AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
                   );
    END IF;

    IF NOT v_is_service_role AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: cancel_expired_p2p_trades is restricted strictly to backend system workers.';
    END IF;

    -- 2. Process Eligible Expired Trades with Transactional Isolation
    FOR v_rec IN 
        SELECT id FROM public.trades
        WHERE expires_at IS NOT NULL
          AND expires_at <= NOW()
          AND paid_at IS NULL
          AND marked_paid_at IS NULL
          AND LOWER(COALESCE(escrow_status, '')) NOT IN ('paid', 'disputed', 'released', 'cancelled', 'expired')
          AND LOWER(COALESCE(status, '')) NOT IN ('completed', 'released', 'cancelled', 'expired', 'paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute')
          AND NOT EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = trades.id AND LOWER(status) = 'open')
    LOOP
        BEGIN
            v_res := public.expire_p2p_trade(v_rec.id);
            IF (v_res->>'success')::BOOLEAN THEN
                v_processed := v_processed + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'processed', v_processed,
        'skipped', v_skipped,
        'failed', v_failed
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 6. Authoritative raise_trade_dispute RPC
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
    IF v_auth_uid IS NOT NULL THEN
        IF p_user_id IS NOT NULL AND p_user_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_caller_id := v_auth_uid;
    ELSE
        IF p_user_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_caller_id := p_user_id;
    END IF;

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
-- 7. Authoritative resolve_trade_dispute RPC
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.resolve_trade_dispute(UUID, TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.resolve_trade_dispute(UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.resolve_trade_dispute(
    p_dispute_id UUID,
    p_resolution TEXT,
    p_winner_id UUID DEFAULT NULL,
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
    v_dispute RECORD;
    v_is_admin BOOLEAN := FALSE;
    v_res JSONB;
BEGIN
    -- 1. Authentication Check
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- 2. Admin Check
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               );

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: only an authorized administrator can resolve disputes.';
    END IF;

    -- 3. Lock Dispute Record FOR UPDATE
    SELECT * INTO v_dispute
    FROM public.disputes
    WHERE id = p_dispute_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispute % not found.', p_dispute_id;
    END IF;

    -- 4. Route Resolution based on Winner
    IF p_winner_id IS NOT NULL THEN
        -- Check if winner is buyer -> release escrow
        IF EXISTS (SELECT 1 FROM public.trades WHERE id = v_dispute.trade_id AND buyer_id = p_winner_id) THEN
            v_res := public.release_trade_escrow(v_dispute.trade_id, v_effective_caller);
        ELSE
            -- Winner is seller -> cancel/refund escrow
            v_res := public.cancel_p2p_trade(v_dispute.trade_id, v_effective_caller, p_resolution);
        END IF;
    ELSE
        -- Default to refunding seller
        v_res := public.cancel_p2p_trade(v_dispute.trade_id, v_effective_caller, p_resolution);
    END IF;

    -- 5. Update Dispute Record
    UPDATE public.disputes
    SET status = 'resolved',
        resolution = p_resolution,
        resolved_by = v_effective_caller,
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_dispute_id;

    RETURN jsonb_build_object(
        'success', true,
        'dispute_id', p_dispute_id,
        'trade_id', v_dispute.trade_id,
        'status', 'resolved',
        'resolution', p_resolution,
        'trade_result', v_res
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 8. Manage Legacy initiate_p2p_trade Function
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
-- 9. Revoke & Grant Exact Privileges
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_p2p_trade(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expired_p2p_trades() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initiate_p2p_trade(UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.expire_p2p_trade(UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.raise_trade_dispute(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade(UUID, UUID, UUID, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated, service_role, postgres;

COMMIT;
