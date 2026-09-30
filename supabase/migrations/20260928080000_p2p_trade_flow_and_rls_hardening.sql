-- ==============================================================================
-- Supabase Migration: 20260928080000_p2p_trade_flow_and_rls_hardening.sql
-- Description: Targeted security, type-safety, and authorization hardening for
--              P2P trades and trade messages.
--              1. Replaces public.is_admin() with authoritative, type-safe implementation:
--                 - Strictly checks public.app_admins and server-controlled raw_app_meta_data
--                 - Strictly excludes client-writable raw_user_meta_data and profiles flags
--                 - Safely recognizes service_role
--                 - Grants EXECUTE strictly to authenticated, service_role, postgres (revokes anon)
--              2. Replaces mark_p2p_trade_paid with type-safe atomic RPC:
--                 - Self-contained authoritative admin check; no calls to public.is_admin()
--                 - Strict ::TEXT = ::TEXT casting on all participant/admin comparisons
--                 - Strict caller identity and impersonation guards
--                 - FOR UPDATE row-level locking
--                 - Idempotent replay and terminal state guards
--                 - Preserves agreed trade.payment_method
--                 - Strictly ZERO financial/escrow/wallet mutations
--              3. Drops legacy uncast RLS policies on public.trades and recreates
--                 strict type-safe SELECT, UPDATE, and INSERT policies.
--              4. Drops legacy uncast RLS policies on public.trade_messages and
--                 recreates strict type-safe SELECT and INSERT policies.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Authoritative, Type-Safe public.is_admin()
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT (auth.role() = 'service_role')
    OR (
        auth.uid() IS NOT NULL AND (
            EXISTS (
                SELECT 1 FROM public.app_admins
                WHERE user_id::TEXT = auth.uid()::TEXT
            ) OR EXISTS (
                SELECT 1 FROM auth.users u
                WHERE u.id::TEXT = auth.uid()::TEXT
                  AND (
                      u.raw_app_meta_data->>'role' = 'admin'
                      OR COALESCE((u.raw_app_meta_data->>'is_admin')::BOOLEAN, false) = true
                  )
            )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 2. Canonical Atomic mark_p2p_trade_paid RPC
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_p2p_trade_paid(UUID);

CREATE OR REPLACE FUNCTION public.mark_p2p_trade_paid(
    p_trade_id UUID,
    p_caller_id UUID DEFAULT NULL,
    p_payment_method TEXT DEFAULT NULL
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
    v_is_buyer BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_now TIMESTAMPTZ := NOW();
    v_payment_method TEXT;
BEGIN
    -- 1. Authentication Check & Impersonation Prevention
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
        RAISE EXCEPTION 'Trade % not found.', p_trade_id;
    END IF;

    -- 3. Authorization Check (Self-contained, type-safe; does NOT call public.is_admin())
    v_is_buyer := (v_effective_caller::TEXT = v_trade.buyer_id::TEXT);
    v_is_admin := (auth.role() = 'service_role')
               OR EXISTS (
                   SELECT 1 FROM public.app_admins
                   WHERE user_id::TEXT = v_effective_caller::TEXT
               )
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id::TEXT = v_effective_caller::TEXT
                     AND (
                         (raw_app_meta_data->>'role') = 'admin' 
                         OR COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, false) = true
                     )
               );

    IF NOT (v_is_buyer OR v_is_admin) THEN
        RAISE EXCEPTION 'Unauthorized: only the trade buyer or an authorized admin can mark trade % as paid.', p_trade_id;
    END IF;

    -- 4. Terminal State Guards
    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is already completed/released.', p_trade_id;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('cancelled', 'expired') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('cancelled', 'expired') THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid: trade is in terminal % state.', p_trade_id, v_trade.status;
    END IF;

    IF LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute') 
       OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed' THEN
        RAISE EXCEPTION 'Cannot mark trade % as paid while a dispute is active.', p_trade_id;
    END IF;

    -- 5. Idempotent Check: Already Paid
    IF (v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL)
       AND (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent')
            OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid') THEN
        RETURN jsonb_build_object(
            'success', true,
            'trade_id', p_trade_id,
            'status', 'paid',
            'escrow_status', 'PAID',
            'paid_at', COALESCE(v_trade.paid_at, v_trade.marked_paid_at),
            'message', 'Trade is already marked as paid (idempotent replay).'
        );
    END IF;

    -- 6. Resolve Payment Method (Preserve agreed trade payment method; fallback to caller input only if existing is NULL/empty)
    v_payment_method := COALESCE(
        NULLIF(TRIM(v_trade.payment_method), ''),
        NULLIF(TRIM(p_payment_method), ''),
        'Bank Transfer'
    );

    -- 7. Atomic Mutation: Update Payment State (NO wallet/escrow balance mutation)
    UPDATE public.trades
    SET status = 'paid',
        escrow_status = 'PAID',
        paid_at = v_now,
        marked_paid_at = v_now,
        payment_method = v_payment_method,
        updated_at = v_now
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'paid',
        'escrow_status', 'PAID',
        'paid_at', v_now,
        'payment_method', v_payment_method
    );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_p2p_trade_paid(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 3. Canonical Atomic release_trade_escrow RPC
-- ------------------------------------------------------------------------------
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
    v_crypto_symbol TEXT;
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
    -- 1. Authentication Check & Impersonation Prevention
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

    -- Canonical Asset Code Resolution
    v_crypto_symbol := UPPER(COALESCE(
        NULLIF(TRIM(v_trade.crypto), ''),
        NULLIF(TRIM(v_trade.asset_code), ''),
        NULLIF(TRIM(v_trade.crypto_currency), ''),
        'USDT'
    ));

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Lock Wallet Assets FOR UPDATE (with defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_crypto_symbol
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_crypto_symbol;
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
        v_crypto_symbol,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    SELECT balance, in_escrow INTO v_buyer_bal, v_buyer_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.buyer_id::TEXT AND asset_symbol = v_crypto_symbol
    FOR UPDATE;

    -- 4. Release Payment Guard
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'));

    IF NOT v_is_paid THEN
        RAISE EXCEPTION 'Trade % cannot be released before payment is marked.', p_trade_id;
    END IF;

    -- 5. Authoritative Admin & Participant Authorization Guard (self-contained, type-safe)
    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    v_is_admin := (auth.role() = 'service_role')
               OR EXISTS (
                   SELECT 1 FROM public.app_admins
                   WHERE user_id::TEXT = v_effective_caller::TEXT
               )
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id::TEXT = v_effective_caller::TEXT
                     AND (
                         (raw_app_meta_data->>'role') = 'admin'
                         OR COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, false) = true
                     )
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

    -- 6. Terminal State & Replay Safety (Idempotency)
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
      AND asset_symbol = v_crypto_symbol
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
        v_crypto_symbol,
        v_crypto_symbol,
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
      AND asset_symbol = v_crypto_symbol
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
        v_crypto_symbol,
        v_crypto_symbol,
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

REVOKE ALL ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 4. Canonical Atomic cancel_p2p_trade RPC
-- ------------------------------------------------------------------------------
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
    v_crypto_symbol TEXT;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);
    v_is_paid BOOLEAN := FALSE;
    v_is_disputed BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    -- 1. Authentication Check & Impersonation Prevention
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

    -- Canonical Asset Code Resolution
    v_crypto_symbol := UPPER(COALESCE(
        NULLIF(TRIM(v_trade.crypto), ''),
        NULLIF(TRIM(v_trade.asset_code), ''),
        NULLIF(TRIM(v_trade.crypto_currency), ''),
        'USDT'
    ));

    v_total_escrow := v_trade.crypto_amount + COALESCE(v_trade.escrow_fee, 0.0);

    -- 3. Determine Payment and Dispute Status
    v_is_paid := (v_trade.paid_at IS NOT NULL)
              OR (v_trade.marked_paid_at IS NOT NULL)
              OR (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid')
              OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent'));

    v_is_disputed := (LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed')
                  OR (LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute'))
                  OR EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = p_trade_id AND LOWER(status) = 'open');

    -- 4. Check Authoritative Admin Privileges (self-contained, type-safe)
    v_is_admin := (auth.role() = 'service_role')
               OR EXISTS (
                   SELECT 1 FROM public.app_admins
                   WHERE user_id::TEXT = v_effective_caller::TEXT
               )
               OR EXISTS (
                   SELECT 1 FROM auth.users
                   WHERE id::TEXT = v_effective_caller::TEXT
                     AND (
                         (raw_app_meta_data->>'role') = 'admin'
                         OR COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, false) = true
                     )
               );

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

    -- 6. Terminal State & Replay Safety (Idempotency)
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

    -- 7. Lock Seller Assets FOR UPDATE (with defensive ::TEXT casting)
    SELECT balance, in_escrow INTO v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id::TEXT = v_trade.seller_id::TEXT AND asset_symbol = v_crypto_symbol
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_trade.seller_id, v_crypto_symbol;
    END IF;

    IF v_seller_escrow < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient in_escrow balance for seller refund %: required %, found in escrow %',
            v_trade.seller_id, v_total_escrow, v_seller_escrow;
    END IF;

    -- 8. Atomic Refund Mutations on wallet_assets
    -- Exact total locked escrow (crypto_amount + escrow_fee) returned to seller spendable balance
    UPDATE public.wallet_assets
    SET balance = balance + v_total_escrow,
        in_escrow = in_escrow - v_total_escrow,
        updated_at = NOW()
    WHERE user_id::TEXT = v_trade.seller_id::TEXT
      AND asset_symbol = v_crypto_symbol
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
        v_crypto_symbol,
        v_crypto_symbol,
        +v_total_escrow,
        'transfer',
        'trade_cancel_seller:' || p_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_refund_seller',
            'trade_id', p_trade_id,
            'refunded_amount', v_total_escrow,
            'reason', p_reason
        ),
        'completed'
    );

    -- 10. Update Trade State
    UPDATE public.trades
    SET status = 'cancelled',
        escrow_status = 'CANCELLED',
        cancelled_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 11. Resolve Active Dispute if present
    UPDATE public.disputes
    SET status = 'resolved'
    WHERE trade_id = p_trade_id AND LOWER(status) = 'open';

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'cancelled',
        'escrow_status', 'CANCELLED',
        'refunded_amount', v_total_escrow
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(UUID, UUID, TEXT) TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 5. Tighten and Fix RLS on public.trades
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view trades they participate in" ON public.trades;
DROP POLICY IF EXISTS "trades_select_policy" ON public.trades;
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "trades_update_policy" ON public.trades;
DROP POLICY IF EXISTS "trades_insert_policy" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;

-- Single type-safe SELECT policy for public.trades
CREATE POLICY "trades_select_policy" ON public.trades
    FOR SELECT USING (
        auth.role() = 'service_role'
        OR (
            auth.uid() IS NOT NULL AND (
                buyer_id::TEXT = auth.uid()::TEXT
                OR seller_id::TEXT = auth.uid()::TEXT
                OR public.is_admin()
            )
        )
    );

-- Only Admins or Service Role may directly UPDATE trades.
-- Ordinary users MUST use canonical RPCs (mark_p2p_trade_paid, release_trade_escrow, etc.)
CREATE POLICY "trades_update_policy" ON public.trades
    FOR UPDATE USING (
        auth.role() = 'service_role' OR public.is_admin()
    ) WITH CHECK (
        auth.role() = 'service_role' OR public.is_admin()
    );

-- Only Admins or Service Role may directly INSERT trades.
-- Ordinary users MUST use initiate_trade_with_escrow RPC.
CREATE POLICY "trades_insert_policy" ON public.trades
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR public.is_admin()
    );

-- ------------------------------------------------------------------------------
-- 4. Fix Uncast RLS Policies on public.trade_messages
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users and admins can view trade messages" ON public.trade_messages;
DROP POLICY IF EXISTS "Users can insert trade messages" ON public.trade_messages;
DROP POLICY IF EXISTS "trade_messages_select_policy" ON public.trade_messages;
DROP POLICYIF EXISTS "trade_messages_insert_policy" ON public.trade_messages;
DROP POLICY IF EXISTS "Participants can view trade messages" ON public.trade_messages;
DROP POLICY IF EXISTS "Participants can insert trade messages" ON public.trade_messages;

-- Type-safe SELECT policy on trade_messages
CREATE POLICY "trade_messages_select_policy" ON public.trade_messages
    FOR SELECT USING (
        auth.role() = 'service_role'
        OR (
            auth.uid() IS NOT NULL AND (
                sender_id::TEXT = auth.uid()::TEXT
                OR EXISTS (
                    SELECT 1 FROM public.trades t
                    WHERE (t.id::TEXT = trade_messages.trade_id::TEXT OR t.trade_id::TEXT = trade_messages.trade_id::TEXT)
                      AND (t.buyer_id::TEXT = auth.uid()::TEXT OR t.seller_id::TEXT = auth.uid()::TEXT)
                )
                OR public.is_admin()
            )
        )
    );

-- Type-safe INSERT policy on trade_messages
CREATE POLICY "trade_messages_insert_policy" ON public.trade_messages
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
        OR (
            auth.uid() IS NOT NULL AND (
                sender_id::TEXT = auth.uid()::TEXT
                AND (
                    EXISTS (
                        SELECT 1 FROM public.trades t
                        WHERE (t.id::TEXT = trade_messages.trade_id::TEXT OR t.trade_id::TEXT = trade_messages.trade_id::TEXT)
                          AND (t.buyer_id::TEXT = auth.uid()::TEXT OR t.seller_id::TEXT = auth.uid()::TEXT)
                    )
                    OR public.is_admin()
                )
            )
        )
    );

COMMIT;
