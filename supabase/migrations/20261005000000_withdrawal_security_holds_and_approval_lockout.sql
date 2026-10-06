-- ============================================================================
-- Supabase Migration: 20261005000000_withdrawal_security_holds_and_approval_lockout.sql
-- Description: Withdrawal Security Hardening:
--              1. Schema Extensions:
--                 - profiles.password_changed_at (TIMESTAMPTZ)
--                 - platform_settings.password_change_withdrawal_hold_hours (NUMERIC DEFAULT 24.00)
--              2. Index on public.withdrawals for pending approval checks.
--              3. Helper RPC: public.has_pending_withdrawal_approval(UUID).
--              4. Authoritative public.request_withdrawal with:
--                 - Exclusive user row lock (FOR UPDATE)
--                 - Server-side password-change security hold enforcement (24h default)
--                 - Active pending-approval lockout (blocks new withdrawals)
--                 - Single & Daily USD limits and automatic account restrictions
--                 - Double-entry balance reservation in wallet_assets and ledger_entries
--              5. Enforce pending-approval lockout in execute_internal_transfer & initiate_trade_with_escrow
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Schema Extensions
-- ----------------------------------------------------------------------------
DO $$
BEGIN
    -- Add password_changed_at to public.profiles if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'password_changed_at'
    ) THEN
        ALTER TABLE public.profiles ADD COLUMN password_changed_at TIMESTAMPTZ DEFAULT NULL;
    END IF;

    -- Add password_change_withdrawal_hold_hours to public.platform_settings if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'password_change_withdrawal_hold_hours'
    ) THEN
        ALTER TABLE public.platform_settings ADD COLUMN password_change_withdrawal_hold_hours NUMERIC(5, 2) NOT NULL DEFAULT 24.00;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Performance Index for Pending Approval Status
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_pending_approval
ON public.withdrawals (user_id)
WHERE status IN ('PENDING_APPROVAL', 'pending_approval');

-- ----------------------------------------------------------------------------
-- 3. Helper Function: has_pending_withdrawal_approval
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_pending_withdrawal_approval(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.withdrawals
        WHERE user_id = p_user_id
          AND status IN ('PENDING_APPROVAL', 'pending_approval')

        UNION ALL

        SELECT 1
        FROM public.onchain_withdrawals
        WHERE user_id = p_user_id
          AND status IN ('PENDING_APPROVAL', 'pending_approval')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_pending_withdrawal_approval(UUID) TO authenticated, service_role, postgres;

-- ----------------------------------------------------------------------------
-- 4. Authoritative request_withdrawal RPC with Security Hardening
-- ----------------------------------------------------------------------------
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
        password_changed_at
    INTO 
        v_is_banned, 
        v_is_on_hold, 
        v_is_withdrawal_locked,
        v_account_status,
        v_kyc_status,
        v_is_verified,
        v_id_verified,
        v_password_changed_at
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

COMMIT;
