-- Migration: 20261002030000_p2p_trade_status_enum_coalesce_hotfix.sql
-- Target: Hotfix for PostgreSQL trade_status / escrow_status ENUM COALESCE casting in release_trade_escrow, cancel_p2p_trade, expire_p2p_trade
-- Reason: Casts v_trade.status and v_trade.escrow_status to TEXT prior to COALESCE to eliminate Error 22P02 (invalid input value for enum trade_status: "")
-- Preserves all UUID/TEXT typecasts from Part 10E and enum-safe LOWER(status::text) on disputes.

-- ----------------------------------------------------------------------------
-- 1. Authoritative release_trade_escrow RPC (ENUM & Typecast Hardened)
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

    -- 3. Lock Wallet Assets FOR UPDATE (Defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_trade.crypto
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
        v_trade.buyer_id::UUID,
        v_trade.crypto,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    SELECT balance, in_escrow INTO v_buyer_bal, v_buyer_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT AND asset_symbol = v_trade.crypto
    FOR UPDATE;

    -- 4. Release Payment Guard (ENUM safe: explicit status::TEXT before COALESCE)
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'));

    IF NOT v_is_paid THEN
        RAISE EXCEPTION 'Trade % cannot be released before payment is marked.', p_trade_id;
    END IF;

    -- 5. Dispute & Participant Authorization Guard (Cast enum status to text for LOWER())
    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open');

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
        IF (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) AND NOT v_is_admin THEN
            RAISE EXCEPTION 'Unauthorized: only the seller or an authorized admin can release escrow for trade %.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety (ENUM safe)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot release trade % in terminal state %.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'RELEASED',
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
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
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
        v_trade.seller_id::UUID,
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
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT
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
        v_trade.buyer_id::UUID,
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

    -- 7f. Resolve Active Dispute if present (Cast enum status to text for LOWER())
    UPDATE public.disputes
    SET status = 'resolved'
    WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open';

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'completed',
        'escrow_status', 'RELEASED'
    );
END;
$$;


-- ----------------------------------------------------------------------------
-- 2. Authoritative cancel_p2p_trade RPC (ENUM & Typecast Hardened)
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

    -- 3. Determine Payment and Dispute Status (ENUM safe)
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent'));

    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open');

    -- 4. Check Admin Privileges
    v_is_admin := public.is_admin()
               OR (v_effective_caller IS NOT NULL AND EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id = v_effective_caller
                     AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
               ));

    -- 5. Non-Admin Security Guards: Strict Cancellation Prohibitions
    IF NOT v_is_admin THEN
        IF (v_effective_caller::TEXT <> v_trade.buyer_id::TEXT) AND (v_effective_caller::TEXT <> v_trade.seller_id::TEXT) THEN
            RAISE EXCEPTION 'Unauthorized: only trade participants or an authorized admin can cancel trade %.', p_trade_id;
        END IF;

        IF v_is_disputed THEN
            RAISE EXCEPTION 'Cannot cancel trade % while a dispute is active. Only an authorized admin can resolve a disputed trade.', p_trade_id;
        END IF;

        IF v_is_paid THEN
            RAISE EXCEPTION 'Cannot cancel trade % after payment has been marked or sent. Post-payment trades must be released or resolved via dispute.', p_trade_id;
        END IF;
    END IF;

    -- 6. Terminal State & Replay Safety (ENUM safe)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot cancel trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'CANCELLED',
            'message', 'Already cancelled (idempotent success)'
        );
    END IF;

    -- 7. Lock Seller Assets FOR UPDATE (Defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_trade.crypto
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
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
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
        v_trade.seller_id::UUID,
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

    -- 11. Resolve Active Dispute if present (Cast enum status to text for LOWER())
    IF v_is_disputed THEN
        UPDATE public.disputes
        SET status = 'resolved',
            resolution = COALESCE(p_reason, 'Refunded to seller by admin dispute resolution'),
            resolved_by = v_effective_caller,
            resolved_at = NOW(),
            updated_at = NOW()
        WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open';
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
-- 3. Authoritative expire_p2p_trade RPC (ENUM & Typecast Hardened)
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

    -- 4. PAID / DISPUTED GUARD: Prohibit Expiration & Refund (ENUM safe)
    v_is_paid_or_disputed := (v_trade.paid_at IS NOT NULL)
                          OR (v_trade.marked_paid_at IS NOT NULL)
                          OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('paid', 'disputed'))
                          OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'))
                          OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status::text) = 'open');

    IF v_is_paid_or_disputed THEN
        RETURN jsonb_build_object(
            'success', false,
            'trade_id', p_trade_id,
            'reason', 'Cannot expire trade in paid or disputed state'
        );
    END IF;

    -- 5. Terminal State & Replay Safety (ENUM safe)
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot expire trade % in completed/released state.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('expired', 'cancelled') OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('expired', 'cancelled') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', v_trade.status,
            'escrow_status', 'EXPIRED',
            'message', 'Already expired (idempotent success)'
        );
    END IF;

    -- 6. Lock Seller Assets FOR UPDATE (Defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_trade.crypto
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
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
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
        v_trade.seller_id::UUID,
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


-- Grants & Security Hardening
REVOKE ALL ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

REVOKE ALL ON FUNCTION public.expire_p2p_trade(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_p2p_trade(UUID) TO service_role, postgres;
