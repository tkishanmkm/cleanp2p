-- ============================================================================
-- Supabase Migration: 20260928040000_withdrawal_security_boundary_hardening.sql
-- Description: Strict Database Security Boundary Hardening for Production Withdrawals:
--              1. Drop all legacy/overloaded withdrawal function signatures.
--              2. Lock down request_withdrawal, approve_withdrawal, complete_onchain_withdrawal,
--                 and process_failed_withdrawal to service_role and postgres ONLY.
--              3. Fix Daily Limit race condition with pre-calculation user profile FOR UPDATE locking.
--              4. Fail-closed admin identity check in approve_withdrawal.
--              5. Revoke direct authenticated execution on all withdrawal mutation RPCs.
-- ============================================================================

-- 1. Drop all existing legacy overloads across all withdrawal RPCs
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT oid::regprocedure AS func_signature
        FROM pg_proc
        WHERE proname IN (
            'request_withdrawal',
            'request_withdrawal_v2',
            'process_withdrawal',
            'approve_withdrawal',
            'complete_onchain_withdrawal',
            'process_failed_withdrawal',
            'claim_pending_withdrawals',
            'claim_next_pending_withdrawal',
            'lock_funds_for_withdrawal'
        )
        AND pronamespace = 'public'::regnamespace
    ) LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || r.func_signature || ' CASCADE;';
    END LOOP;
END $$;

-- 2. Stored Procedure: request_withdrawal (Service-Role & Postgres ONLY, Atomic User Locking)
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT DEFAULT 'USDT',
    p_usd_equivalent NUMERIC(18, 2) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_balance NUMERIC(36, 18);
    v_in_withdrawal NUMERIC(36, 18);
    v_total_deduct NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_network_clean TEXT := UPPER(TRIM(p_network));
    
    -- User profile fields
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
    v_is_withdrawal_locked BOOLEAN := FALSE;
    v_account_status TEXT;
    v_kyc_status TEXT;
    v_is_verified BOOLEAN := FALSE;
    v_id_verified BOOLEAN := FALSE;
    
    -- Platform Governance Limits
    v_max_single_usd NUMERIC(18, 2) := 4000.00;
    v_approval_threshold_usd NUMERIC(18, 2) := 2000.00;
    v_daily_limit_usd NUMERIC(18, 2) := 10000.00;
    v_withdrawals_enabled BOOLEAN := TRUE;
    v_kill_switch BOOLEAN := FALSE;
    
    -- Rolling 24h calculation
    v_rolling_24h_usd NUMERIC(18, 2) := 0;
    v_effective_usd NUMERIC(18, 2) := 0;
    v_requires_approval BOOLEAN := FALSE;
    v_initial_status TEXT := 'QUEUED';
    v_onchain_status TEXT := 'PENDING';
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    -- Validate Supported Production Assets & Networks ONLY
    IF v_asset_clean = 'USDT' THEN
        IF v_network_clean NOT IN ('TRC20', 'TRON', 'ERC20', 'ETH', 'ETHEREUM', 'BEP20', 'BSC', 'BINANCE') THEN
            RAISE EXCEPTION 'Unsupported network % for USDT withdrawal. Supported: TRC20, ERC20, BEP20', p_network;
        END IF;
    ELSIF v_asset_clean = 'BTC' THEN
        IF v_network_clean NOT IN ('BTC', 'BITCOIN') THEN
            RAISE EXCEPTION 'Unsupported network % for BTC withdrawal. Supported: BTC', p_network;
        END IF;
    ELSIF v_asset_clean = 'ETH' THEN
        IF v_network_clean NOT IN ('ETH', 'ERC20', 'ETHEREUM') THEN
            RAISE EXCEPTION 'Unsupported network % for ETH withdrawal. Supported: ETH/ERC20', p_network;
        END IF;
    ELSIF v_asset_clean = 'LTC' THEN
        IF v_network_clean NOT IN ('LTC', 'LITECOIN') THEN
            RAISE EXCEPTION 'Unsupported network % for LTC withdrawal. Supported: LTC', p_network;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported asset % for withdrawal. Supported: USDT, BTC, ETH, LTC', p_asset;
    END IF;

    -- Normalize network aliases
    IF v_network_clean IN ('TRON') THEN v_network_clean := 'TRC20'; END IF;
    IF v_network_clean IN ('ETHEREUM') THEN v_network_clean := 'ERC20'; END IF;
    IF v_network_clean IN ('BSC', 'BINANCE') THEN v_network_clean := 'BEP20'; END IF;
    IF v_network_clean IN ('BITCOIN') THEN v_network_clean := 'BTC'; END IF;
    IF v_network_clean IN ('LITECOIN') THEN v_network_clean := 'LTC'; END IF;

    -- Fetch Platform Governance Settings
    SELECT 
        COALESCE(max_single_withdrawal_usd, 4000.00),
        COALESCE(withdrawal_approval_threshold_usd, 2000.00),
        COALESCE(daily_withdrawal_limit_usd, 10000.00),
        COALESCE(withdrawals_enabled, true),
        COALESCE(global_kill_switch_active, false)
    INTO 
        v_max_single_usd,
        v_approval_threshold_usd,
        v_daily_limit_usd,
        v_withdrawals_enabled,
        v_kill_switch
    FROM public.platform_settings
    WHERE id = 1;

    IF v_kill_switch OR NOT v_withdrawals_enabled THEN
        RAISE EXCEPTION 'EMERGENCY_PAUSE: Withdrawals are temporarily disabled for maintenance.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 1: EXCLUSIVE USER ROW LOCK (SERIALIZES CONCURRENT WITHDRAWALS)
    -- =========================================================================
    SELECT 
        COALESCE(is_banned, FALSE), 
        COALESCE(is_on_hold, FALSE), 
        COALESCE(is_withdrawal_locked, FALSE),
        account_status,
        kyc_status,
        COALESCE(is_verified, FALSE),
        COALESCE(id_verified, FALSE)
    INTO 
        v_is_banned, 
        v_is_on_hold, 
        v_is_withdrawal_locked,
        v_account_status,
        v_kyc_status,
        v_is_verified,
        v_id_verified
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for ID %', p_user_id;
    END IF;

    -- Check if user account is currently restricted/banned
    IF v_is_banned OR v_is_on_hold OR v_is_withdrawal_locked OR v_account_status IN ('restricted', 'frozen', 'banned') THEN
        RAISE EXCEPTION 'ACCOUNT_RESTRICTED: Account is restricted from initiating withdrawals.';
    END IF;

    -- Enforce Strict KYC Identity Verification
    IF NOT (v_is_verified OR v_kyc_status IN ('approved', 'verified') OR v_id_verified) THEN
        RAISE EXCEPTION 'KYC_REQUIRED: Identity verification is required before initiating withdrawals.';
    END IF;

    -- Authoritative USD Equivalent (Server-provided or pegged fallback)
    IF p_usd_equivalent IS NOT NULL AND p_usd_equivalent > 0 THEN
        v_effective_usd := p_usd_equivalent;
    ELSIF v_asset_clean = 'USDT' THEN
        v_effective_usd := p_amount;
    ELSE
        v_effective_usd := p_amount;
    END IF;

    -- =========================================================================
    -- RULE 1: $4,000 HARD MAXIMUM ENFORCEMENT & AUTOMATIC ACCOUNT RESTRICTION
    -- =========================================================================
    IF v_effective_usd > v_max_single_usd THEN
        UPDATE public.profiles
        SET account_status = 'restricted',
            is_withdrawal_locked = true,
            updated_at = NOW()
        WHERE id = p_user_id;

        INSERT INTO public.admin_audit_logs (
            admin_id,
            admin_email,
            action,
            details,
            created_at
        ) VALUES (
            p_user_id,
            'security_monitor@paxones.com',
            'SECURITY_VIOLATION_HARD_MAX_EXCEEDED',
            jsonb_build_object(
                'user_id', p_user_id,
                'attempted_usd', v_effective_usd,
                'hard_max_usd', v_max_single_usd,
                'asset', v_asset_clean,
                'amount', p_amount,
                'action_taken', 'ACCOUNT_FROZEN_RESTRICTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Maximum single withdrawal limit ($%) exceeded. Account has been restricted for security review.', v_max_single_usd;
    END IF;

    -- =========================================================================
    -- RULE 2: ROLLING 24-HOUR DAILY LIMIT (CALCULATED UNDER USER ROW LOCK)
    -- =========================================================================
    SELECT COALESCE(SUM(amount), 0)
    INTO v_rolling_24h_usd
    FROM public.withdrawals
    WHERE user_id = p_user_id
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND status IN ('completed', 'processing', 'QUEUED', 'PENDING_APPROVAL', 'APPROVED', 'approved', 'pending');

    IF (v_rolling_24h_usd + v_effective_usd) > v_daily_limit_usd THEN
        UPDATE public.profiles
        SET account_status = 'restricted',
            is_withdrawal_locked = true,
            updated_at = NOW()
        WHERE id = p_user_id;

        INSERT INTO public.admin_audit_logs (
            admin_id,
            admin_email,
            action,
            details,
            created_at
        ) VALUES (
            p_user_id,
            'security_monitor@paxones.com',
            'SECURITY_VIOLATION_DAILY_LIMIT_EXCEEDED',
            jsonb_build_object(
                'user_id', p_user_id,
                'past_24h_usd', v_rolling_24h_usd,
                'attempted_usd', v_effective_usd,
                'daily_limit_usd', v_daily_limit_usd,
                'action_taken', 'ACCOUNT_FROZEN_RESTRICTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Daily withdrawal limit ($%) exceeded. Account has been restricted for security review.', v_daily_limit_usd;
    END IF;

    -- =========================================================================
    -- RULE 3: $2,000 APPROVAL THRESHOLD STATE MACHINE
    -- =========================================================================
    IF v_effective_usd >= v_approval_threshold_usd THEN
        v_requires_approval := TRUE;
        v_initial_status := 'PENDING_APPROVAL';
        v_onchain_status := 'PENDING_APPROVAL';
    ELSE
        v_requires_approval := FALSE;
        v_initial_status := 'QUEUED';
        v_onchain_status := 'PENDING';
    END IF;

    v_total_deduct := p_amount + COALESCE(p_fee, 0);

    -- Find or provision wallet identity
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = p_user_id
        LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (p_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- Lock Authoritative wallet_assets row
    SELECT balance, in_withdrawal
    INTO v_balance, v_in_withdrawal
    FROM public.wallet_assets
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean
    FOR UPDATE;

    IF v_balance IS NULL OR v_balance < v_total_deduct THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Required: % (Amount % + Fee %)',
            COALESCE(v_balance, 0), v_total_deduct, p_amount, COALESCE(p_fee, 0);
    END IF;

    -- Generate Withdrawal UUID
    v_withdrawal_id := gen_random_uuid();

    -- Atomically deduct spendable balance and credit in_withdrawal
    UPDATE public.wallet_assets
    SET balance = balance - v_total_deduct,
        in_withdrawal = in_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean;

    -- Insert into public.withdrawals
    INSERT INTO public.withdrawals (
        id,
        user_id,
        wallet_id,
        asset_symbol,
        asset_code,
        amount,
        network_fee,
        destination_address,
        network,
        network_code,
        status,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_wallet_id,
        v_asset_clean,
        v_asset_clean,
        p_amount,
        COALESCE(p_fee, 0),
        p_to_address,
        v_network_clean,
        v_network_clean,
        v_initial_status,
        'w_' || v_withdrawal_id::TEXT,
        NOW(),
        NOW()
    );

    -- Insert into public.onchain_withdrawals
    INSERT INTO public.onchain_withdrawals (
        id,
        user_id,
        wallet_id,
        to_address,
        amount,
        asset_symbol,
        network,
        status,
        metadata,
        created_at,
        updated_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_wallet_id,
        p_to_address,
        p_amount,
        v_asset_clean,
        v_network_clean,
        v_onchain_status,
        jsonb_build_object(
            'fee', COALESCE(p_fee, 0), 
            'total_deducted', v_total_deduct,
            'usd_equivalent', v_effective_usd,
            'requires_approval', v_requires_approval
        ),
        NOW(),
        NOW()
    );

    -- Record Double-Entry Immutable Ledger Entry
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
        idempotency_key,
        created_at
    ) VALUES (
        v_wallet_id,
        p_user_id,
        v_asset_clean,
        -v_total_deduct,
        +v_total_deduct,
        v_balance - v_total_deduct,
        v_in_withdrawal + v_total_deduct,
        'withdrawal_lock',
        'withdrawals',
        v_withdrawal_id::TEXT,
        'wlock_' || v_withdrawal_id::TEXT,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'status', v_initial_status,
        'requires_approval', v_requires_approval,
        'total_debited', v_total_deduct,
        'message', 'Withdrawal Pending'
    );
END;
$$;

-- 3. Stored Procedure: approve_withdrawal (Service-Role & Postgres ONLY, Fail-Closed Verification)
CREATE OR REPLACE FUNCTION public.approve_withdrawal(
    p_withdrawal_id UUID,
    p_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    IF p_admin_id IS NULL THEN
        RAISE EXCEPTION 'Unauthorized: Valid admin identifier is required to approve withdrawals.';
    END IF;

    -- Verify caller admin status strictly
    SELECT EXISTS (
        SELECT 1 FROM public.app_admins WHERE user_id = p_admin_id
        UNION
        SELECT 1 FROM public.profiles WHERE id = p_admin_id AND (role = 'admin' OR is_admin = true)
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not a platform administrator.';
    END IF;

    SELECT *
    INTO v_withdrawal
    FROM public.withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    IF v_withdrawal.status NOT IN ('PENDING_APPROVAL', 'pending_approval', 'pending') THEN
        RAISE EXCEPTION 'Withdrawal % cannot be approved (current status: %)', p_withdrawal_id, v_withdrawal.status;
    END IF;

    -- Transition status to APPROVED / QUEUED for worker pickup
    UPDATE public.withdrawals
    SET status = 'QUEUED',
        approved_by = p_admin_id,
        approved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Transition onchain_withdrawals to PENDING (making it claimable by worker)
    UPDATE public.onchain_withdrawals
    SET status = 'PENDING',
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Record Audit Log
    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        'admin_approver@paxones.com',
        'ADMIN_APPROVED_WITHDRAWAL',
        jsonb_build_object(
            'withdrawal_id', p_withdrawal_id,
            'amount', v_withdrawal.amount,
            'asset', v_withdrawal.asset_symbol
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'QUEUED',
        'message', 'Withdrawal approved and queued for broadcast'
    );
END;
$$;

-- 4. Stored Procedure: complete_onchain_withdrawal (Service-Role & Postgres ONLY)
CREATE OR REPLACE FUNCTION public.complete_onchain_withdrawal(
    p_withdrawal_id UUID,
    p_tx_hash TEXT,
    p_actual_gas_amount NUMERIC DEFAULT 0,
    p_gas_asset TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_total_deducted NUMERIC(36, 18);
    v_fee NUMERIC(36, 18) := 0;
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    SELECT *
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT id, user_id, wallet_id, amount, asset_symbol, network, status
        INTO v_withdrawal
        FROM public.withdrawals
        WHERE id = p_withdrawal_id
        FOR UPDATE;
    END IF;

    IF v_withdrawal.id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    IF LOWER(v_withdrawal.status) IN ('confirmed', 'completed') THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already confirmed');
    END IF;

    -- Extract fee if recorded in metadata
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_deducted := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_deducted := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- Release liability from in_withdrawal
    UPDATE public.wallet_assets
    SET in_withdrawal = GREATEST(0, in_withdrawal - v_total_deducted),
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id AND asset_symbol = v_withdrawal.asset_symbol
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    -- Mark onchain_withdrawals as COMPLETED
    UPDATE public.onchain_withdrawals
    SET status = 'COMPLETED',
        tx_hash = COALESCE(p_tx_hash, tx_hash),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Update withdrawals table
    UPDATE public.withdrawals
    SET status = 'completed',
        tx_hash = COALESCE(p_tx_hash, tx_hash),
        txid = COALESCE(p_tx_hash, txid),
        broadcasted_at = COALESCE(broadcasted_at, NOW()),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Insert double-entry completion ledger record
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
        idempotency_key,
        created_at
    )
    VALUES (
        v_withdrawal.wallet_id,
        v_withdrawal.user_id,
        v_withdrawal.asset_symbol,
        0,
        -v_total_deducted,
        COALESCE(v_balance_after, 0),
        COALESCE(v_in_withdrawal_after, 0),
        'withdrawal_complete',
        'withdrawals',
        p_withdrawal_id::TEXT,
        'wcomp_' || p_withdrawal_id::TEXT,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'COMPLETED'
    );
END;
$$;

-- 5. Stored Procedure: process_failed_withdrawal (Service-Role & Postgres ONLY)
CREATE OR REPLACE FUNCTION public.process_failed_withdrawal(
    p_withdrawal_id UUID,
    p_error_reason TEXT,
    p_actual_gas_amount NUMERIC DEFAULT 0,
    p_gas_asset TEXT DEFAULT NULL,
    p_is_verified_revert BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_fee NUMERIC(36, 18) := 0;
    v_total_refund NUMERIC(36, 18);
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    SELECT *
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT id, user_id, wallet_id, amount, asset_symbol, network, status
        INTO v_withdrawal
        FROM public.withdrawals
        WHERE id = p_withdrawal_id
        FOR UPDATE;
    END IF;

    IF v_withdrawal.id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- Idempotency check: If already failed, do not refund again
    IF LOWER(v_withdrawal.status) = 'failed' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already marked as failed');
    END IF;

    IF LOWER(v_withdrawal.status) IN ('confirmed', 'completed') THEN
        RAISE EXCEPTION 'Cannot refund completed withdrawal %', p_withdrawal_id;
    END IF;

    -- Extract fee if recorded in metadata
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_refund := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_refund := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- Credit balance and release in_withdrawal in wallet_assets
    UPDATE public.wallet_assets
    SET balance = balance + v_total_refund,
        in_withdrawal = GREATEST(0, in_withdrawal - v_total_refund),
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id AND asset_symbol = v_withdrawal.asset_symbol
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    -- Mark onchain_withdrawals as FAILED
    UPDATE public.onchain_withdrawals
    SET status = 'FAILED',
        error_message = COALESCE(p_error_reason, 'Worker broadcast failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Update withdrawals table
    UPDATE public.withdrawals
    SET status = 'failed',
        broadcast_error = COALESCE(p_error_reason, 'Worker broadcast failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Record refund double-entry ledger entry
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
        idempotency_key,
        created_at
    )
    VALUES (
        v_withdrawal.wallet_id,
        v_withdrawal.user_id,
        v_withdrawal.asset_symbol,
        +v_total_refund,
        -v_total_refund,
        COALESCE(v_balance_after, 0),
        COALESCE(v_in_withdrawal_after, 0),
        'withdrawal_refund',
        'withdrawals',
        p_withdrawal_id::TEXT,
        'wrefund_' || p_withdrawal_id::TEXT,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'refunded_amount', v_total_refund,
        'status', 'FAILED'
    );
END;
$$;

-- 6. Stored Procedure: claim_pending_withdrawals (Service-Role & Postgres ONLY)
CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(
    p_limit INTEGER DEFAULT 10
)
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT id
        FROM public.onchain_withdrawals
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.onchain_withdrawals w
    SET status = 'PROCESSING',
        updated_at = NOW()
    FROM claimed c
    WHERE w.id = c.id
    RETURNING w.*;
END;
$$;

-- 7. Stored Procedure: claim_next_pending_withdrawal (Service-Role & Postgres ONLY)
CREATE OR REPLACE FUNCTION public.claim_next_pending_withdrawal()
RETURNS SETOF public.onchain_withdrawals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT id
        FROM public.onchain_withdrawals
        WHERE status = 'PENDING'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.onchain_withdrawals w
    SET status = 'PROCESSING',
        updated_at = NOW()
    FROM claimed c
    WHERE w.id = c.id
    RETURNING w.*;
END;
$$;

-- ============================================================================
-- 8. STRICT PRIVILEGE LOCKDOWN: REVOKE FROM authenticated, GRANT TO service_role ONLY
-- ============================================================================

-- A. request_withdrawal
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;

-- B. approve_withdrawal
REVOKE EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(UUID, UUID) TO service_role, postgres;

-- C. complete_onchain_withdrawal
REVOKE EXECUTE ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) TO service_role, postgres;

-- D. process_failed_withdrawal
REVOKE EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO service_role, postgres;

-- E. claim_pending_withdrawals
REVOKE EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) TO service_role, postgres;

-- F. claim_next_pending_withdrawal
REVOKE EXECUTE ON FUNCTION public.claim_next_pending_withdrawal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_pending_withdrawal() TO service_role, postgres;
