-- ============================================================================
-- Supabase Migration: 20261005030000_enforce_individual_emergency_freeze_financial_rpcs.sql
-- Description: Enforces authoritative database-level individual emergency freeze
--              in the three canonical financial RPCs:
--              1. public.initiate_trade_with_escrow
--              2. public.request_withdrawal
--              3. public.execute_internal_transfer
--              Uses deterministic row locking (profiles FOR UPDATE) and raises
--              USER_EMERGENCY_FROZEN before any financial or escrow mutations.
-- ============================================================================

BEGIN;

-- Historical trade-RPC replacement intentionally omitted here: its source
-- depended on public.p2p_ads%ROWTYPE, but clean installations use public.ads.
-- The later migration 20261007010000_canonical_public_ads_identifier_resolution.sql
-- installs the canonical public.ads-based initiate_trade_with_escrow and retains
-- individual emergency-freeze checks. Keep withdrawal and internal-transfer
-- freeze enforcement below in this migration.

-- ============================================================================
-- 2. CANONICAL request_withdrawal WITH INDIVIDUAL EMERGENCY FREEZE
-- ============================================================================
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
    v_is_emergency_frozen BOOLEAN := FALSE;
    v_account_status TEXT;
    v_kyc_status TEXT;
    v_is_verified BOOLEAN := FALSE;
    v_id_verified BOOLEAN := FALSE;
    v_password_changed_at TIMESTAMPTZ := NULL;
    
    -- Platform Governance Limits
    v_max_single_usd NUMERIC(18, 2) := 4000.00;
    v_approval_threshold_usd NUMERIC(18, 2) := 2000.00;
    v_daily_limit_usd NUMERIC(18, 2) := 10000.00;
    v_pwd_hold_hours NUMERIC(5, 2) := 24.00;
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

    -- Validate Supported Production Assets & Networks ONLY (No Polygon USDT)
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
        COALESCE(password_change_withdrawal_hold_hours, 24.00),
        COALESCE(withdrawals_enabled, true),
        COALESCE(global_kill_switch_active, false)
    INTO 
        v_max_single_usd,
        v_approval_threshold_usd,
        v_daily_limit_usd,
        v_pwd_hold_hours,
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
        COALESCE(id_verified, FALSE),
        password_changed_at,
        COALESCE(is_emergency_frozen, FALSE)
    INTO 
        v_is_banned, 
        v_is_on_hold, 
        v_is_withdrawal_locked,
        v_account_status,
        v_kyc_status,
        v_is_verified,
        v_id_verified,
        v_password_changed_at,
        v_is_emergency_frozen
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for ID %', p_user_id;
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 1.1: AUTHORITATIVE INDIVIDUAL EMERGENCY FREEZE CHECK
    -- =========================================================================
    IF v_is_emergency_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: Your account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    -- Check if user account is currently restricted/banned
    IF v_is_banned OR v_is_on_hold OR v_is_withdrawal_locked OR v_account_status IN ('restricted', 'frozen', 'banned') THEN
        RAISE EXCEPTION 'ACCOUNT_RESTRICTED: Account is restricted from initiating withdrawals.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 2: PASSWORD CHANGE SECURITY HOLD ENFORCEMENT
    -- =========================================================================
    IF v_password_changed_at IS NOT NULL AND v_password_changed_at > (NOW() - (v_pwd_hold_hours || ' hours')::INTERVAL) THEN
        RAISE EXCEPTION 'PASSWORD_WITHDRAWAL_HOLD: Withdrawals are temporarily suspended following a recent password change for security reasons.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 3: ACTIVE PENDING APPROVAL LOCKOUT
    -- =========================================================================
    IF public.has_pending_withdrawal_approval(p_user_id) THEN
        RAISE EXCEPTION 'WITHDRAWAL_APPROVAL_PENDING: Your previous withdrawal is awaiting administrator approval. You cannot create another withdrawal until it is approved or rejected.';
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
    -- RULE 1: HARD MAXIMUM ENFORCEMENT & AUTOMATIC ACCOUNT RESTRICTION
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
    -- RULE 3: APPROVAL THRESHOLD STATE MACHINE
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
        'message', CASE WHEN v_requires_approval THEN 'Withdrawal awaiting administrator approval' ELSE 'Withdrawal Pending' END
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;

-- ============================================================================
-- 3. CANONICAL execute_internal_transfer WITH INDIVIDUAL EMERGENCY FREEZE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
    p_sender_id UUID,
    p_recipient_username TEXT,
    p_asset TEXT,
    p_gross_amount NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_username TEXT := LOWER(TRIM(COALESCE(p_recipient_username, '')));
    v_asset_clean TEXT := UPPER(TRIM(COALESCE(p_asset, '')));
    v_clean_idempotency TEXT := NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '');
    v_recipient_id UUID;
    v_recipient_name TEXT;
    v_sender_name TEXT;
    v_sender_status TEXT;
    v_recipient_status TEXT;
    v_sender_banned BOOLEAN := FALSE;
    v_sender_restricted BOOLEAN := FALSE;
    v_recipient_banned BOOLEAN := FALSE;
    v_recipient_restricted BOOLEAN := FALSE;
    v_sender_frozen BOOLEAN := FALSE;
    v_recipient_frozen BOOLEAN := FALSE;
    
    -- Financial Variables
    v_recipient_amount NUMERIC(36, 18);
    v_fee_amount NUMERIC(36, 18);
    v_total_deduction NUMERIC(36, 18);
    v_fee_rate NUMERIC(10, 6) := 0.015; -- 1.5% platform fee
    
    -- Wallet Asset State Variables
    v_sender_wallet_asset_id UUID;
    v_sender_bal NUMERIC(36, 18);
    v_recipient_wallet_asset_id UUID;
    v_recipient_bal NUMERIC(36, 18);
    v_sender_bal_after NUMERIC(36, 18);
    v_recipient_bal_after NUMERIC(36, 18);
    
    -- Transfer Record Variables
    v_transfer_id UUID;
    v_public_id TEXT;
    v_existing_transfer RECORD;
BEGIN
    -- 1. Input Validation
    IF p_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ID is required');
    END IF;

    -- Security check: Enforce caller identity unless executing under service_role
    IF auth.role() <> 'service_role' AND auth.uid() IS NOT NULL AND auth.uid() <> p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Sender identity mismatch');
    END IF;

    IF v_clean_username = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient username is required');
    END IF;

    IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transfer amount must be strictly greater than zero');
    END IF;

    -- Supported Asset Validation (Strictly USDT, BTC, ETH, LTC)
    IF v_asset_clean NOT IN ('USDT', 'BTC', 'ETH', 'LTC') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unsupported asset for transfer: ' || v_asset_clean || '. Supported: USDT, BTC, ETH, LTC'
        );
    END IF;

    -- Preliminary lookup to resolve recipient UUID for deterministic lock ordering
    SELECT id INTO v_recipient_id
    FROM public.profiles
    WHERE LOWER(username) = v_clean_username
       OR LOWER(email) = v_clean_username
       OR id::TEXT = v_clean_username
    LIMIT 1;

    -- Fallback: Check deposit addresses for recipient user resolution
    IF v_recipient_id IS NULL THEN
        SELECT uda.user_id INTO v_recipient_id
        FROM public.user_deposit_addresses uda
        WHERE uda.address = p_recipient_username
        LIMIT 1;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient user @' || p_recipient_username || ' not found on the platform');
    END IF;

    IF v_recipient_id = p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot transfer funds to yourself');
    END IF;

    -- =========================================================================
    -- DETERMINISTIC ROW LOCKING: Lock profiles in consistent UUID order (smaller first)
    -- =========================================================================
    IF p_sender_id < v_recipient_id THEN
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;
    ELSE
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    END IF;

    IF v_sender_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile not found');
    END IF;

    -- =========================================================================
    -- INDIVIDUAL EMERGENCY FREEZE VALIDATION (Sender & Recipient)
    -- =========================================================================
    IF v_sender_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_sender_banned OR v_sender_restricted OR v_sender_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account is restricted or non-active. Transfers are blocked.');
    END IF;

    IF v_recipient_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient profile not found');
    END IF;

    IF v_recipient_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot transfer: Recipient account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_recipient_banned OR v_recipient_restricted OR v_recipient_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot transfer: Recipient account is restricted or non-active on the platform.');
    END IF;

    -- 4. Full Multi-Parameter Idempotency Validation with Advisory Lock
    IF v_clean_idempotency IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('trf:' || p_sender_id::TEXT || ':' || v_clean_idempotency));

        SELECT * INTO v_existing_transfer
        FROM public.transfers
        WHERE sender_id = p_sender_id AND idempotency_key = v_clean_idempotency
        LIMIT 1;

        IF v_existing_transfer.id IS NOT NULL THEN
            IF v_existing_transfer.recipient_id <> v_recipient_id
               OR UPPER(COALESCE(v_existing_transfer.crypto, v_existing_transfer.asset_symbol, '')) <> v_asset_clean
               OR v_existing_transfer.amount <> p_gross_amount THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Idempotency conflict: A transfer with this idempotency key was already submitted with different parameters (recipient, asset, or amount)'
                );
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'transfer_id', v_existing_transfer.id,
                'public_id', COALESCE(v_existing_transfer.public_id, v_existing_transfer.transfer_id, v_existing_transfer.id::TEXT),
                'sender_id', v_existing_transfer.sender_id,
                'recipient_id', v_existing_transfer.recipient_id,
                'recipient', COALESCE(v_existing_transfer.recipient_username, v_recipient_name),
                'recipient_username', COALESCE(v_existing_transfer.recipient_username, v_recipient_name),
                'sender_username', COALESCE(v_existing_transfer.sender_username, v_sender_name),
                'asset', v_asset_clean,
                'amount', v_existing_transfer.amount,
                'gross_amount', v_existing_transfer.amount,
                'net_amount', v_existing_transfer.amount,
                'fee', COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'fee_amount', COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'status', COALESCE(v_existing_transfer.status::TEXT, 'confirmed'),
                'message', 'Transfer already processed successfully (idempotent replay)'
            );
        END IF;
    END IF;

    -- 5. Calculate Exact 1.5% Fee & Financial Deductions
    v_recipient_amount := p_gross_amount;
    v_fee_amount := ROUND((v_recipient_amount * v_fee_rate)::numeric, 8);
    v_total_deduction := v_recipient_amount + v_fee_amount;

    -- 6. Ensure Recipient wallet_assets record exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        locked_balance,
        reserved_balance,
        in_escrow,
        in_withdrawal,
        created_at,
        updated_at
    )
    VALUES (
        v_recipient_id,
        v_asset_clean,
        0,
        0,
        0,
        0,
        0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    -- 7. Deterministic Deadlock-Safe Row Locking on wallet_assets
    IF p_sender_id < v_recipient_id THEN
        SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
        FROM public.wallet_assets
        WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;
    ELSE
        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
        FROM public.wallet_assets
        WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
        FOR UPDATE;
    END IF;

    IF v_sender_wallet_asset_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ' || v_asset_clean || ' wallet asset record not found');
    END IF;

    IF v_recipient_wallet_asset_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient ' || v_asset_clean || ' wallet asset record not found');
    END IF;

    -- 8. Spendable Balance Validation
    IF v_sender_bal IS NULL OR v_sender_bal < v_total_deduction THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient spendable ' || v_asset_clean || ' balance. Required: ' || v_total_deduction::TEXT || ' ' || v_asset_clean || ' (Recipient Amount: ' || v_recipient_amount::TEXT || ' + 1.5% Fee: ' || v_fee_amount::TEXT || '), Available: ' || COALESCE(v_sender_bal, 0)::TEXT || ' ' || v_asset_clean
        );
    END IF;

    -- 9. Atomic Financial Balance Mutations on wallet_assets
    v_sender_bal_after := v_sender_bal - v_total_deduction;
    UPDATE public.wallet_assets
    SET balance = v_sender_bal_after,
        updated_at = NOW()
    WHERE id = v_sender_wallet_asset_id;

    v_recipient_bal_after := v_recipient_bal + v_recipient_amount;
    UPDATE public.wallet_assets
    SET balance = v_recipient_bal_after,
        updated_at = NOW()
    WHERE id = v_recipient_wallet_asset_id;

    -- 10. Generate Transfer IDs
    v_transfer_id := gen_random_uuid();
    v_public_id := 'TRF' || UPPER(SUBSTRING(REPLACE(v_transfer_id::TEXT, '-', ''), 1, 9));

    -- 11. Record Transfer in public.transfers
    INSERT INTO public.transfers (
        id,
        public_id,
        sender_id,
        recipient_id,
        amount,
        crypto,
        fee_amount,
        fee,
        status,
        transfer_id,
        sender_username,
        recipient_username,
        asset_symbol,
        idempotency_key,
        created_at
    )
    VALUES (
        v_transfer_id,
        v_public_id,
        p_sender_id,
        v_recipient_id,
        v_recipient_amount,
        v_asset_clean,
        v_fee_amount,
        v_fee_amount,
        'confirmed',
        v_public_id,
        v_sender_name,
        v_recipient_name,
        v_asset_clean,
        v_clean_idempotency,
        NOW()
    );

    -- 12. Record Double-Entry in public.ledger_entries
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        chain,
        amount,
        type,
        status,
        reference_id,
        balance_after,
        metadata,
        created_at
    )
    VALUES (
        p_sender_id,
        v_asset_clean,
        v_asset_clean,
        'INTERNAL',
        -v_total_deduction,
        'transfer',
        'completed',
        v_transfer_id::TEXT,
        v_sender_bal_after,
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'public_id', v_public_id,
            'recipient_id', v_recipient_id,
            'recipient_username', v_recipient_name,
            'recipient_amount', v_recipient_amount,
            'fee_amount', v_fee_amount,
            'fee_rate', v_fee_rate,
            'total_deduction', v_total_deduction,
            'direction', 'SENT',
            'idempotency_key', v_clean_idempotency
        ),
        NOW()
    );

    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        chain,
        amount,
        type,
        status,
        reference_id,
        balance_after,
        metadata,
        created_at
    )
    VALUES (
        v_recipient_id,
        v_asset_clean,
        v_asset_clean,
        'INTERNAL',
        v_recipient_amount,
        'transfer',
        'completed',
        v_transfer_id::TEXT,
        v_recipient_bal_after,
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'public_id', v_public_id,
            'sender_id', p_sender_id,
            'sender_username', v_sender_name,
            'received_amount', v_recipient_amount,
            'direction', 'RECEIVED',
            'idempotency_key', v_clean_idempotency
        ),
        NOW()
    );

    -- 13. Record Platform Revenue in public.platform_ledger_entries
    IF v_fee_amount > 0 THEN
        INSERT INTO public.platform_ledger_entries (
            entry_type,
            asset_code,
            amount,
            direction,
            related_user_id,
            ref_table,
            ref_id,
            network_code,
            idempotency_key,
            metadata,
            created_at
        )
        VALUES (
            'transfer_fee_collected',
            v_asset_clean,
            v_fee_amount,
            'CREDIT',
            p_sender_id,
            'transfers',
            v_transfer_id::TEXT,
            'INTERNAL',
            'fee_transfer_' || v_transfer_id::TEXT,
            jsonb_build_object(
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'sender_id', p_sender_id,
                'recipient_id', v_recipient_id,
                'recipient_amount', v_recipient_amount,
                'fee_amount', v_fee_amount,
                'fee_rate', v_fee_rate,
                'total_deduction', v_total_deduction,
                'asset', v_asset_clean,
                'original_idempotency_key', v_clean_idempotency
            ),
            NOW()
        );
    END IF;

    -- 14. Create In-App Notification for Recipient
    BEGIN
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            message,
            metadata,
            is_read,
            created_at
        )
        VALUES (
            v_recipient_id,
            'transfer',
            'Transfer Received',
            'You received ' || v_recipient_amount::TEXT || ' ' || v_asset_clean || ' from @' || v_sender_name,
            jsonb_build_object(
                'sender_id', p_sender_id,
                'sender_username', v_sender_name,
                'amount', v_recipient_amount,
                'asset', v_asset_clean,
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'link', '/wallet'
            ),
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 15. Return Comprehensive Result Payload
    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'public_id', v_public_id,
        'sender_id', p_sender_id,
        'recipient_id', v_recipient_id,
        'recipient', v_recipient_name,
        'recipient_username', v_recipient_name,
        'sender_username', v_sender_name,
        'asset', v_asset_clean,
        'amount', v_recipient_amount,
        'gross_amount', v_recipient_amount,
        'net_amount', v_recipient_amount,
        'fee', v_fee_amount,
        'fee_amount', v_fee_amount,
        'total_deduction', v_total_deduction,
        'sender_balance_after', v_sender_bal_after,
        'recipient_balance_after', v_recipient_bal_after,
        'status', 'confirmed',
        'idempotent_replay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

COMMIT;
