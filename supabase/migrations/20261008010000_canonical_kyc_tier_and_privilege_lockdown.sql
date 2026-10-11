-- ==============================================================================
-- Supabase Migration: 20261008010000_canonical_kyc_tier_and_privilege_lockdown.sql
-- Description: PART 39C — Canonical KYC Tier Enforcement for request_withdrawal,
--              Platform Governance Settings Hardening, Live Schema Preservation,
--              and Exact Signature Overloaded Function Privilege Lockdown.
--
-- Invariants Preserved:
--   - Authoritative KYC Tier 2 requirement via public.get_user_kyc_tier(p_user_id) < 2
--   - 24-hour password-change security hold
--   - Single withdrawal limit ($4,000 USD) with rejection (zero direct profile update)
--   - Rolling 24-hour withdrawal limit ($10,000 USD) with trustworthy valuation
--   - Approval threshold ($2,000 USD)
--   - In-flight pending withdrawal approval lockout
--   - Global emergency mode & platform settings kill switches
--   - Individual emergency freeze enforcement
--   - Supported assets (USDT, BTC, ETH, LTC) & networks (TRC20, ERC20, BEP20)
--   - Strict exclusion of Polygon
--   - Live wallet_assets schema: (id, user_id, asset_symbol, balance, locked_balance,
--     reserved_balance, in_escrow, in_withdrawal, created_at, updated_at)
--   - Live withdrawal accounting:
--     balance = balance - v_total_deduct
--     in_withdrawal = in_withdrawal + v_total_deduct
--   - Live public.withdrawals schema without wallet_id or idempotency_key
--   - Live public.onchain_withdrawals schema with non-null wallet_id validation
--   - Live public.ledger_entries schema without platform_ledger_entries columns
--   - Zero direct UPDATE on public.profiles protected fields
--   - Exact signature existence guards (to_regprocedure) for all 7 legacy revocations
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 0. PLATFORM_SETTINGS TABLE SCHEMA HARDENING & SINGLETON SEED
-- Ensure governance column exists and default singleton row is present.
-- Preserves existing settings, kill switches, and fee configurations without modification.
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'platform_settings' AND column_name = 'withdrawal_approval_threshold_usd'
    ) THEN
        ALTER TABLE public.platform_settings ADD COLUMN withdrawal_approval_threshold_usd NUMERIC(18, 2) NOT NULL DEFAULT 2000.00;
    END IF;

    -- Ensure default singleton row 1 exists without overwriting established settings
    INSERT INTO public.platform_settings (
        id, 
        withdrawals_enabled, 
        global_kill_switch_active, 
        max_single_withdrawal_usd, 
        daily_withdrawal_limit_usd, 
        withdrawal_approval_threshold_usd, 
        password_change_withdrawal_hold_hours
    ) VALUES (
        1, 
        true, 
        false, 
        4000.00, 
        10000.00, 
        2000.00, 
        24.00
    ) ON CONFLICT (id) DO UPDATE SET
        withdrawal_approval_threshold_usd = COALESCE(public.platform_settings.withdrawal_approval_threshold_usd, 2000.00);
END $$;

-- ------------------------------------------------------------------------------
-- 1. CANONICAL public.request_withdrawal WITH STRICT TIER 2 ENFORCEMENT & LIVE SCHEMAS
-- ------------------------------------------------------------------------------
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
    v_asset_clean TEXT := UPPER(TRIM(COALESCE(p_asset, 'USDT')));
    v_network_clean TEXT := UPPER(TRIM(COALESCE(p_network, '')));
    
    -- User profile fields
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
    v_is_withdrawal_locked BOOLEAN := FALSE;
    v_is_emergency_frozen BOOLEAN := FALSE;
    v_account_status TEXT;
    v_kyc_status TEXT;
    v_password_changed_at TIMESTAMPTZ := NULL;
    
    -- Canonical Platform Controls (system_settings)
    v_sys_emergency_val JSONB := NULL;
    v_sys_prevent_withdrawals_val JSONB := NULL;
    v_sys_emergency_mode BOOLEAN := NULL;
    v_sys_prevent_withdrawals BOOLEAN := NULL;

    -- Platform Governance Limits (platform_settings)
    v_max_single_usd NUMERIC(18, 2) := 4000.00;
    v_approval_threshold_usd NUMERIC(18, 2) := 2000.00;
    v_daily_limit_usd NUMERIC(18, 2) := 10000.00;
    v_pwd_hold_hours NUMERIC(5, 2) := 24.00;
    v_withdrawals_enabled BOOLEAN := TRUE;
    v_kill_switch BOOLEAN := FALSE;
    
    -- Valuation and rolling 24h calculation
    v_market_price NUMERIC(18, 4) := NULL;
    v_calculated_usd NUMERIC(18, 2) := 0;
    v_effective_usd NUMERIC(18, 2) := 0;
    v_rolling_24h_usd NUMERIC(18, 2) := 0;
    v_requires_approval BOOLEAN := FALSE;
    v_initial_status TEXT := 'QUEUED';
    v_onchain_status TEXT := 'PENDING';
BEGIN
    -- Input Validation
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    IF p_fee IS NULL OR p_fee < 0 THEN
        RAISE EXCEPTION 'Withdrawal fee must be non-negative';
    END IF;

    IF p_to_address IS NULL OR TRIM(p_to_address) = '' THEN
        RAISE EXCEPTION 'Destination address is required';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 0: AUTHORITATIVE GLOBAL EMERGENCY MODE & PLATFORM CONTROLS
    -- Checked from public.system_settings BEFORE any user locks or deductions.
    -- FAIL CLOSED: If controls cannot be read, verified, or parsed, REJECT withdrawal.
    -- =========================================================================
    SELECT value INTO v_sys_emergency_val
    FROM public.system_settings
    WHERE key = 'emergency_mode';

    SELECT value INTO v_sys_prevent_withdrawals_val
    FROM public.system_settings
    WHERE key = 'prevent_withdrawals';

    IF v_sys_emergency_val IS NULL OR v_sys_prevent_withdrawals_val IS NULL THEN
        RAISE EXCEPTION 'Platform emergency control state is unavailable. Withdrawal rejected for security reasons.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF jsonb_typeof(v_sys_emergency_val) = 'boolean' THEN
        v_sys_emergency_mode := (v_sys_emergency_val)::boolean;
    ELSIF jsonb_typeof(v_sys_emergency_val) = 'string' THEN
        v_sys_emergency_mode := (LOWER(v_sys_emergency_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for emergency_mode. Withdrawal rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF jsonb_typeof(v_sys_prevent_withdrawals_val) = 'boolean' THEN
        v_sys_prevent_withdrawals := (v_sys_prevent_withdrawals_val)::boolean;
    ELSIF jsonb_typeof(v_sys_prevent_withdrawals_val) = 'string' THEN
        v_sys_prevent_withdrawals := (LOWER(v_sys_prevent_withdrawals_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for prevent_withdrawals. Withdrawal rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF v_sys_emergency_mode THEN
        RAISE EXCEPTION 'Platform is under Global Emergency Mode. Withdrawals are strictly suspended.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_EMERGENCY_MODE';
    END IF;

    IF v_sys_prevent_withdrawals THEN
        RAISE EXCEPTION 'Crypto withdrawals are temporarily disabled by administrator.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_WITHDRAWALS_DISABLED';
    END IF;

    -- Validate Supported Production Assets & Networks ONLY (Strict exclusion of Polygon)
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

    -- Defensive fallback in case table has no row matching id=1
    v_max_single_usd := COALESCE(v_max_single_usd, 4000.00);
    v_approval_threshold_usd := COALESCE(v_approval_threshold_usd, 2000.00);
    v_daily_limit_usd := COALESCE(v_daily_limit_usd, 10000.00);
    v_pwd_hold_hours := COALESCE(v_pwd_hold_hours, 24.00);
    v_withdrawals_enabled := COALESCE(v_withdrawals_enabled, true);
    v_kill_switch := COALESCE(v_kill_switch, false);

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
        password_changed_at,
        COALESCE(is_emergency_frozen, FALSE)
    INTO 
        v_is_banned, 
        v_is_on_hold, 
        v_is_withdrawal_locked,
        v_account_status,
        v_kyc_status,
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

    -- =========================================================================
    -- CRITICAL STEP 3.1: AUTHORITATIVE CANONICAL KYC TIER 2 ENFORCEMENT
    -- Strictly requires public.get_user_kyc_tier(p_user_id) >= 2.
    -- Replaces legacy multi-boolean condition (v_is_verified OR v_id_verified OR ...)
    -- =========================================================================
    IF public.get_user_kyc_tier(p_user_id) < 2 THEN
        RAISE EXCEPTION 'KYC_REQUIRED: Identity verification is required before initiating withdrawals.'
            USING ERRCODE = 'P0001', DETAIL = 'TIER_2_KYC_REQUIRED';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 3.2: TRUSTWORTHY USD VALUATION
    -- For USDT: exactly 1.0 USD peg.
    -- For BTC/ETH/LTC: verified against public.crypto_market_prices feed.
    -- Prevents caller manipulation of p_usd_equivalent to bypass limit thresholds.
    -- =========================================================================
    IF v_asset_clean = 'USDT' THEN
        v_effective_usd := GREATEST(p_amount, COALESCE(p_usd_equivalent, p_amount));
    ELSE
        SELECT price_in_fiat INTO v_market_price
        FROM public.crypto_market_prices
        WHERE asset_symbol = v_asset_clean AND fiat_symbol = 'USD';

        IF v_market_price IS NOT NULL AND v_market_price > 0 THEN
            v_calculated_usd := p_amount * v_market_price;
            v_effective_usd := GREATEST(COALESCE(p_usd_equivalent, 0), v_calculated_usd);
        ELSE
            -- Fail-safe: if live price feed record is not found in table, require trustworthy server-provided valuation
            IF p_usd_equivalent IS NULL OR p_usd_equivalent <= 0 THEN
                RAISE EXCEPTION 'USD valuation unavailable for asset %. Withdrawal rejected for security reasons.', v_asset_clean
                    USING ERRCODE = 'P0001', DETAIL = 'VALUATION_UNAVAILABLE';
            END IF;
            v_effective_usd := p_usd_equivalent;
        END IF;
    END IF;

    -- =========================================================================
    -- RULE 1: HARD MAXIMUM ENFORCEMENT ($4,000 USD)
    -- Strict rejection and security audit log. Zero direct UPDATE on public.profiles.
    -- =========================================================================
    IF v_effective_usd > v_max_single_usd THEN
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
                'action_taken', 'WITHDRAWAL_REJECTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Maximum single withdrawal limit ($%) exceeded. Transaction rejected.', v_max_single_usd;
    END IF;

    -- =========================================================================
    -- RULE 2: ROLLING 24-HOUR DAILY LIMIT ($10,000 USD)
    -- Trustworthy USD valuation per withdrawal:
    -- USDT valued at 1:1; other assets joined with public.crypto_market_prices (USD).
    -- Strict rejection and security audit log. Zero direct UPDATE on public.profiles.
    -- =========================================================================
    SELECT COALESCE(SUM(
        w.amount * CASE 
            WHEN UPPER(TRIM(COALESCE(w.asset_symbol, w.asset_code, w.asset, 'USDT'))) IN ('USDT', 'USDC') THEN 1.0
            ELSE COALESCE(cmp.price_in_fiat, 0)
        END
    ), 0)
    INTO v_rolling_24h_usd
    FROM public.withdrawals w
    LEFT JOIN public.crypto_market_prices cmp
        ON cmp.asset_symbol = UPPER(TRIM(COALESCE(w.asset_symbol, w.asset_code, w.asset, 'USDT')))
        AND cmp.fiat_symbol = 'USD'
    WHERE w.user_id = p_user_id
      AND w.created_at >= NOW() - INTERVAL '24 hours'
      AND w.status NOT IN ('REJECTED', 'FAILED', 'CANCELLED', 'rejected', 'failed', 'cancelled');

    IF (v_rolling_24h_usd + v_effective_usd) > v_daily_limit_usd THEN
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
                'action_taken', 'WITHDRAWAL_REJECTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Daily withdrawal limit ($%) exceeded. Transaction rejected.', v_daily_limit_usd;
    END IF;

    -- =========================================================================
    -- RULE 3: APPROVAL THRESHOLD STATE MACHINE ($2,000 USD)
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

    v_total_deduct := p_amount + p_fee;

    -- =========================================================================
    -- CRITICAL STEP 4: WALLET BALANCE RESERVATION (AUTHORITATIVE ACCOUNTING)
    -- Preserves live wallet_assets schema: (id, user_id, asset_symbol, balance, ...)
    -- balance is atomically debited and credited to in_withdrawal reservation.
    -- =========================================================================
    SELECT balance, in_withdrawal
    INTO v_balance, v_in_withdrawal
    FROM public.wallet_assets
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean
    FOR UPDATE;

    IF v_balance IS NULL OR v_balance < v_total_deduct THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Required: % (Amount % + Fee %)',
            COALESCE(v_balance, 0), v_total_deduct, p_amount, p_fee;
    END IF;

    -- Generate Withdrawal UUID
    v_withdrawal_id := gen_random_uuid();

    -- Atomically deduct spendable balance and credit in_withdrawal reservation
    UPDATE public.wallet_assets
    SET balance = balance - v_total_deduct,
        in_withdrawal = in_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean;

    -- Insert into public.withdrawals (Preserving exact live table schema - no wallet_id or idempotency_key)
    INSERT INTO public.withdrawals (
        id,
        user_id,
        chain,
        network,
        network_code,
        token_symbol,
        asset_symbol,
        asset_code,
        asset,
        amount,
        fee,
        network_fee,
        total_deducted,
        to_address,
        destination_address,
        status,
        requires_admin_approval,
        approval_reason,
        created_at,
        updated_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_network_clean,
        v_network_clean,
        v_network_clean,
        v_asset_clean,
        v_asset_clean,
        v_asset_clean,
        v_asset_clean,
        p_amount,
        p_fee,
        p_fee,
        v_total_deduct,
        p_to_address,
        p_to_address,
        v_initial_status,
        v_requires_approval,
        CASE WHEN v_requires_approval THEN 'High value withdrawal exceeds approval threshold' ELSE NULL END,
        NOW(),
        NOW()
    );

    -- Find wallet identity for onchain_withdrawals foreign key
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id
    ORDER BY created_at ASC
    LIMIT 1;

    -- Strict non-null wallet identity validation prior to insertion into onchain_withdrawals
    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet identity not found for user ID %', p_user_id
            USING ERRCODE = 'P0001', DETAIL = 'WALLET_IDENTITY_NOT_FOUND';
    END IF;

    -- Insert into public.onchain_withdrawals (Preserving exact live table schema)
    INSERT INTO public.onchain_withdrawals (
        id,
        user_id,
        wallet_id,
        network,
        to_address,
        amount,
        fee,
        asset_symbol,
        status,
        idempotency_key,
        created_at,
        updated_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_wallet_id,
        v_network_clean,
        p_to_address,
        p_amount,
        p_fee,
        v_asset_clean,
        v_onchain_status,
        'ow_' || v_withdrawal_id::TEXT,
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
        status = v_onchain_status,
        updated_at = NOW();

    -- Record Double-Entry Ledger Entry (Preserving exact live public.ledger_entries schema)
    INSERT INTO public.ledger_entries (
        user_id,
        amount,
        type,
        crypto,
        asset,
        chain,
        status,
        reference_id,
        balance_after,
        metadata,
        created_at
    ) VALUES (
        p_user_id,
        -v_total_deduct,
        'withdrawal',
        v_asset_clean,
        v_asset_clean,
        v_network_clean,
        'pending',
        'withdrawal:' || v_withdrawal_id::TEXT,
        v_balance - v_total_deduct,
        jsonb_build_object(
            'withdrawal_id', v_withdrawal_id,
            'destination_address', p_to_address,
            'network', v_network_clean,
            'amount', p_amount,
            'fee', p_fee,
            'requires_admin_approval', v_requires_approval,
            'status', v_initial_status
        ),
        NOW()
    );

    -- Audit Log for High-Value Withdrawal Queued For Approval
    IF v_requires_approval THEN
        INSERT INTO public.admin_audit_logs (
            admin_id, admin_email, action, details, created_at
        ) VALUES (
            p_user_id,
            'system@paxones.com',
            'HIGH_VALUE_WITHDRAWAL_QUEUED_FOR_APPROVAL',
            jsonb_build_object(
                'withdrawal_id', v_withdrawal_id,
                'user_id', p_user_id,
                'amount', p_amount,
                'asset', v_asset_clean,
                'usd_value', v_effective_usd,
                'threshold', v_approval_threshold_usd
            ),
            NOW()
        );
    END IF;

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

-- Restrictive execution privileges for request_withdrawal
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 2. EXACT LEGACY ZOMBIE FUNCTION PRIVILEGE LOCKDOWN
-- Guard every legacy-function REVOKE by exact signature existence (to_regprocedure).
-- ------------------------------------------------------------------------------

-- Overload 1: create_p2p_trade
DO $$
BEGIN
    IF to_regprocedure('public.create_p2p_trade(text, uuid, uuid, numeric, numeric, character varying, character varying)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.create_p2p_trade(text, uuid, uuid, numeric, numeric, character varying, character varying) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 2: create_sell_advertisement (character varying variant)
DO $$
BEGIN
    IF to_regprocedure('public.create_sell_advertisement(uuid, character varying, character varying, numeric, numeric, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.create_sell_advertisement(uuid, character varying, character varying, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 3: create_sell_advertisement (text variant)
DO $$
BEGIN
    IF to_regprocedure('public.create_sell_advertisement(uuid, text, text, numeric, numeric, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.create_sell_advertisement(uuid, text, text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 4: execute_final_withdrawal (character varying variant)
DO $$
BEGIN
    IF to_regprocedure('public.execute_final_withdrawal(uuid, character varying, character varying, text, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.execute_final_withdrawal(uuid, character varying, character varying, text, numeric) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 5: execute_final_withdrawal (text variant)
DO $$
BEGIN
    IF to_regprocedure('public.execute_final_withdrawal(uuid, text, text, text, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.execute_final_withdrawal(uuid, text, text, text, numeric) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 6: execute_wallet_transfer
DO $$
BEGIN
    IF to_regprocedure('public.execute_wallet_transfer(uuid, uuid, text, numeric, numeric, text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.execute_wallet_transfer(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

-- Overload 7: process_external_withdrawal
DO $$
BEGIN
    IF to_regprocedure('public.process_external_withdrawal(uuid, text, text, numeric)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.process_external_withdrawal(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
    END IF;
END $$;

COMMIT;
