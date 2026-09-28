-- ============================================================================
-- Supabase Migration: 20260928010000_p2p_escrow_hardened_rpcs.sql
-- Description: Corrected Production P2P Escrow RPC Replacement Migration.
--              Drops ALL legacy overloads, implements strict double-entry ledger
--              settlement, enforces fail-closed idempotency, and verifies exact signatures.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Explicitly Drop ALL Legacy Signatures AND Proposed Replacement Signatures
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.release_trade_escrow(UUID, UUID);
DROP FUNCTION IF EXISTS public.cancel_p2p_trade(UUID, UUID);
DROP FUNCTION IF EXISTS public.cancel_p2p_trade(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.expire_p2p_trade(UUID);
DROP FUNCTION IF EXISTS public.expire_p2p_trade(UUID, UUID);
DROP FUNCTION IF EXISTS public.cancel_expired_p2p_trades();

-- ----------------------------------------------------------------------------
-- 2. Authoritative release_trade_escrow RPC
-- ----------------------------------------------------------------------------
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
    v_seller_wallet_id UUID;
    v_buyer_wallet_id UUID;
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
    v_srel_rec RECORD;
    v_brel_rec RECORD;
    v_pf_rec RECORD;
    v_srel_id UUID;
    v_brel_id UUID;
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

    -- 3. Lock Wallet Infrastructure FOR UPDATE
    SELECT id INTO v_seller_wallet_id
    FROM public.wallets
    WHERE user_id = v_trade.seller_id;

    IF v_seller_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Seller wallet infrastructure record not found for user %', v_trade.seller_id;
    END IF;

    SELECT id INTO v_buyer_wallet_id
    FROM public.wallets
    WHERE user_id = v_trade.buyer_id;

    IF v_buyer_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Buyer wallet infrastructure record not found for user %', v_trade.buyer_id;
    END IF;

    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.seller_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_trade.crypto;
    END IF;

    SELECT balance, in_escrow INTO v_buyer_bal, v_buyer_escrow
    FROM public.wallet_assets
    WHERE user_id = v_trade.buyer_id AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Buyer wallet_assets record not found for user % and asset %', v_trade.buyer_id, v_trade.crypto;
    END IF;

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
        -- Verify Complete Seller Release Ledger
        SELECT * INTO v_srel_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_srel_' || p_trade_id::TEXT;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial state corruption: trade % is marked completed but lacks seller release ledger record.', p_trade_id;
        END IF;

        IF v_srel_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_srel_rec.wallet_id IS DISTINCT FROM v_seller_wallet_id
           OR v_srel_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_srel_rec.delta_available IS DISTINCT FROM 0.0
           OR v_srel_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_srel_rec.entry_type IS DISTINCT FROM 'p2p_escrow_release'
           OR v_srel_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_srel_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing seller release ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;

        -- Verify Complete Buyer Release Ledger
        SELECT * INTO v_brel_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_brel_' || p_trade_id::TEXT;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial state corruption: trade % is marked completed but lacks buyer release ledger record.', p_trade_id;
        END IF;

        IF v_brel_rec.user_id IS DISTINCT FROM v_trade.buyer_id
           OR v_brel_rec.wallet_id IS DISTINCT FROM v_buyer_wallet_id
           OR v_brel_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_brel_rec.delta_available IS DISTINCT FROM v_trade.crypto_amount
           OR v_brel_rec.delta_locked IS DISTINCT FROM 0.0
           OR v_brel_rec.entry_type IS DISTINCT FROM 'p2p_escrow_release'
           OR v_brel_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_brel_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing buyer release ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;

        -- Verify Complete Platform Fee Ledger (if applicable)
        IF COALESCE(v_trade.escrow_fee, 0.0) > 0 THEN
            SELECT * INTO v_pf_rec
            FROM public.platform_ledger_entries
            WHERE idempotency_key = 'pf_p2pfee_' || p_trade_id::TEXT;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Financial state corruption: trade % is marked completed but lacks platform fee ledger record.', p_trade_id;
            END IF;

            IF v_pf_rec.asset_code IS DISTINCT FROM v_trade.crypto
               OR v_pf_rec.amount IS DISTINCT FROM v_trade.escrow_fee
               OR v_pf_rec.direction IS DISTINCT FROM 'CREDIT'
               OR v_pf_rec.related_user_id IS DISTINCT FROM v_trade.seller_id
               OR v_pf_rec.ref_table IS DISTINCT FROM 'trades'
               OR v_pf_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
               OR v_pf_rec.entry_type IS DISTINCT FROM 'trade_fee_collected'
            THEN
                RAISE EXCEPTION 'Financial idempotency conflict: existing platform fee record for trade % differs from expected fee parameters.', p_trade_id;
            END IF;
        END IF;

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

    -- 7b. Record Seller Release Ledger Entry with Strict Replay Check
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
        0.0,
        -v_total_escrow,
        v_seller_bal_after,
        v_seller_escrow_after,
        'p2p_escrow_release',
        'trades',
        p_trade_id::TEXT,
        'p2p_srel_' || p_trade_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_srel_id;

    IF v_srel_id IS NULL THEN
        SELECT * INTO v_srel_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_srel_' || p_trade_id::TEXT
        FOR UPDATE;

        IF v_srel_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_srel_rec.wallet_id IS DISTINCT FROM v_seller_wallet_id
           OR v_srel_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_srel_rec.delta_available IS DISTINCT FROM 0.0
           OR v_srel_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_srel_rec.entry_type IS DISTINCT FROM 'p2p_escrow_release'
           OR v_srel_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_srel_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing seller release ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;
    END IF;

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

    -- 7d. Record Buyer Release Ledger Entry with Strict Replay Check
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
        v_buyer_wallet_id,
        v_trade.buyer_id,
        v_trade.crypto,
        +v_trade.crypto_amount,
        0.0,
        v_buyer_bal_after,
        v_buyer_escrow_after,
        'p2p_escrow_release',
        'trades',
        p_trade_id::TEXT,
        'p2p_brel_' || p_trade_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_brel_id;

    IF v_brel_id IS NULL THEN
        SELECT * INTO v_brel_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_brel_' || p_trade_id::TEXT
        FOR UPDATE;

        IF v_brel_rec.user_id IS DISTINCT FROM v_trade.buyer_id
           OR v_brel_rec.wallet_id IS DISTINCT FROM v_buyer_wallet_id
           OR v_brel_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_brel_rec.delta_available IS DISTINCT FROM v_trade.crypto_amount
           OR v_brel_rec.delta_locked IS DISTINCT FROM 0.0
           OR v_brel_rec.entry_type IS DISTINCT FROM 'p2p_escrow_release'
           OR v_brel_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_brel_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing buyer release ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;
    END IF;

    -- 7e. Record Platform Trade Fee (if fee > 0)
    IF COALESCE(v_trade.escrow_fee, 0.0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'trade_fee_collected',
            p_asset_code := v_trade.crypto,
            p_amount := v_trade.escrow_fee,
            p_direction := 'CREDIT',
            p_related_user_id := v_trade.seller_id,
            p_ref_table := 'trades',
            p_ref_id := p_trade_id::TEXT,
            p_network_code := NULL,
            p_tx_hash := NULL,
            p_idempotency_key := 'pf_p2pfee_' || p_trade_id::TEXT,
            p_metadata := jsonb_build_object(
                'crypto_amount', v_trade.crypto_amount,
                'escrow_fee', v_trade.escrow_fee,
                'fiat_amount', v_trade.fiat_amount,
                'buyer_id', v_trade.buyer_id,
                'seller_id', v_trade.seller_id
            )
        );
    END IF;

    -- 7f. Update Trade State to Completed
    UPDATE public.trades
    SET status = 'completed',
        escrow_status = 'RELEASED',
        released_at = NOW(),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7g. Resolve Active Dispute if present
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

    -- 3. POST-PAYMENT CANCELLATION PROHIBITION GUARD (NO ADMIN BYPASS)
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'));

    IF v_is_paid THEN
        RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
    END IF;

    -- 4. ACTIVE DISPUTE GUARD
    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    IF v_is_disputed THEN
        RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active.', p_trade_id;
    END IF;

    -- 5. Participant Authorization Check
    v_is_admin := public.is_admin()
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               );

    IF v_effective_caller <> v_trade.buyer_id AND v_effective_caller <> v_trade.seller_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
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

    -- 8. Atomic Refund Mutations
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
    v_seller_wallet_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid_or_disputed BOOLEAN := FALSE;
    v_exp_rec RECORD;
    v_exp_id UUID;
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
        SELECT * INTO v_exp_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_exp_' || p_trade_id::TEXT;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Financial state corruption: trade % is marked expired but lacks expiration ledger record.', p_trade_id;
        END IF;

        IF v_exp_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_exp_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_exp_rec.delta_available IS DISTINCT FROM v_total_escrow
           OR v_exp_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_exp_rec.entry_type IS DISTINCT FROM 'p2p_escrow_refund'
           OR v_exp_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_exp_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing expiration ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'message', 'Already expired (idempotent success)'
        );
    END IF;

    -- 6. Lock Seller Infrastructure & Assets FOR UPDATE
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

    -- 8. Record Seller Expiration Refund Ledger Entry with Strict Replay Check
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
        'p2p_escrow_refund',
        'trades',
        p_trade_id::TEXT,
        'p2p_exp_' || p_trade_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_exp_id;

    IF v_exp_id IS NULL THEN
        SELECT * INTO v_exp_rec
        FROM public.ledger_entries
        WHERE idempotency_key = 'p2p_exp_' || p_trade_id::TEXT
        FOR UPDATE;

        IF v_exp_rec.user_id IS DISTINCT FROM v_trade.seller_id
           OR v_exp_rec.wallet_id IS DISTINCT FROM v_seller_wallet_id
           OR v_exp_rec.asset_code IS DISTINCT FROM v_trade.crypto
           OR v_exp_rec.delta_available IS DISTINCT FROM v_total_escrow
           OR v_exp_rec.delta_locked IS DISTINCT FROM (-v_total_escrow)
           OR v_exp_rec.entry_type IS DISTINCT FROM 'p2p_escrow_refund'
           OR v_exp_rec.ref_table IS DISTINCT FROM 'trades'
           OR v_exp_rec.ref_id IS DISTINCT FROM p_trade_id::TEXT
        THEN
            RAISE EXCEPTION 'Financial idempotency conflict: existing expiration ledger record for trade % differs from expected parameters.', p_trade_id;
        END IF;
    END IF;

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
-- 6. Restore Function Privileges (ACLs)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_p2p_trade(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_expired_p2p_trades() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.expire_p2p_trade(UUID) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() TO service_role, postgres;


-- ----------------------------------------------------------------------------
-- 7. Exact-Signature Verification & Legacy Reference Check
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_total_func_count INTEGER := 0;
    v_legacy_ref_count INTEGER := 0;
    v_unexpected_overloads INTEGER := 0;
BEGIN
    -- 7a. Verify exactly 4 functions exist for these pronames in public schema
    SELECT COUNT(*) INTO v_total_func_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('release_trade_escrow', 'cancel_p2p_trade', 'expire_p2p_trade', 'cancel_expired_p2p_trades');

    IF v_total_func_count <> 4 THEN
        RAISE EXCEPTION 'Verification failure: expected exactly 4 routines for P2P escrow, found %', v_total_func_count;
    END IF;

    -- 7b. Verify legacy overloads cancel_p2p_trade(uuid,uuid) and expire_p2p_trade(uuid,uuid) do NOT exist
    SELECT COUNT(*) INTO v_unexpected_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND (
          (p.proname = 'cancel_p2p_trade' AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid')
          OR (p.proname = 'expire_p2p_trade' AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid')
      );

    IF v_unexpected_overloads > 0 THEN
        RAISE EXCEPTION 'Verification failure: legacy overloads still exist in database.';
    END IF;

    -- 7c. Verify the 4 exact authoritative signatures contain ZERO legacy table references
    SELECT COUNT(*) INTO v_legacy_ref_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('release_trade_escrow', 'cancel_p2p_trade', 'expire_p2p_trade', 'cancel_expired_p2p_trades')
      AND (
          pg_get_functiondef(p.oid) ILIKE '%escrow_ledger%'
          OR pg_get_functiondef(p.oid) ILIKE '%financial_ledger%'
          OR pg_get_functiondef(p.oid) ILIKE '%admin_main_wallets%'
      );

    IF v_legacy_ref_count > 0 THEN
        RAISE EXCEPTION 'Verification failure: replacement functions still reference legacy accounting tables.';
    END IF;
END $$;

COMMIT;
