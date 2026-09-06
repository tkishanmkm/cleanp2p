-- ============================================================================
-- Supabase Migration: 20260907000000_security_hotfix.sql
-- Description: Comprehensive hardening against privilege escalation, RLS bypasses,
--              fail-open checks, and missing stored procedures.
-- ============================================================================

-- 1. HARDEN PROFILES TABLE RLS
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE 
    USING (auth.uid() = id) 
    WITH CHECK (
        auth.uid() = id 
        -- Prevent regular users from tampering with role and is_admin
        AND (role IS NOT DISTINCT FROM (SELECT role FROM public.profiles WHERE id = auth.uid()))
        AND (is_admin IS NOT DISTINCT FROM (SELECT is_admin FROM public.profiles WHERE id = auth.uid()))
        -- Prevent unbanning or lifting hold on own account
        AND (is_banned IS NOT DISTINCT FROM (SELECT is_banned FROM public.profiles WHERE id = auth.uid()))
        AND (is_on_hold IS NOT DISTINCT FROM (SELECT is_on_hold FROM public.profiles WHERE id = auth.uid()))
    );

-- 2. HARDEN check_is_admin STORED PROCEDURE
-- STRICT RULE: Never inspect raw_user_meta_data for roles!
CREATE OR REPLACE FUNCTION public.check_is_admin(
    p_user_id UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := COALESCE(p_user_id, user_uuid, auth.uid());
    v_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 1. Only allow verified server-controlled app_metadata (never raw_user_meta_data)
    SELECT (
        COALESCE(raw_app_meta_data->>'role', '') = 'admin' OR
        COALESCE(raw_app_meta_data->>'is_admin', 'false')::BOOLEAN
    ) INTO v_is_admin
    FROM auth.users
    WHERE id = v_uid;

    IF v_is_admin IS TRUE THEN
        RETURN TRUE;
    END IF;

    -- 2. Check dedicated app_admins table
    IF EXISTS (
        SELECT 1 FROM public.app_admins WHERE user_id = v_uid
    ) THEN
        RETURN TRUE;
    END IF;

    -- 3. Check profiles table with strict boolean check
    SELECT (COALESCE(role, '') = 'admin' AND is_admin IS TRUE)
    INTO v_is_admin
    FROM public.profiles
    WHERE id = v_uid;

    RETURN COALESCE(v_is_admin, FALSE);
END;
$$;

-- 3. IMPLEMENT SAFE ATOMIC credit_user_balance STORED PROCEDURE
CREATE OR REPLACE FUNCTION public.credit_user_balance(
    target_user_id UUID,
    target_asset TEXT,
    target_network TEXT,
    credit_amount NUMERIC(36, 18)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(target_asset));
    v_new_balance NUMERIC(36, 18);
BEGIN
    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target user ID is required';
    END IF;

    IF credit_amount IS NULL OR credit_amount <= 0 THEN
        RAISE EXCEPTION 'Credit amount must be positive';
    END IF;

    -- Get or create user wallet
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = target_user_id
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (target_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- Upsert and lock wallet_assets
    INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at)
    VALUES (v_wallet_id, v_asset_clean, credit_amount, 0, 0, NOW())
    ON CONFLICT (wallet_id, asset_code)
    DO UPDATE SET 
        available = public.wallet_assets.available + EXCLUDED.available,
        updated_at = NOW()
    RETURNING available INTO v_new_balance;

    -- Dual-ledger sync: if users table has balance_usdt and asset is USDT, keep in sync
    IF v_asset_clean = 'USDT' THEN
        BEGIN
            UPDATE public.users 
            SET balance_usdt = COALESCE(balance_usdt, 0) + credit_amount
            WHERE id = target_user_id;
        EXCEPTION WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END IF;

    -- Record in ledger
    INSERT INTO public.ledger_entries (
        user_id, wallet_id, type, asset, amount, status, metadata
    ) VALUES (
        target_user_id,
        v_wallet_id,
        'deposit_credit',
        v_asset_clean,
        credit_amount,
        'confirmed',
        jsonb_build_object('network', target_network, 'credited_at', NOW())
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'user_id', target_user_id,
        'asset', v_asset_clean,
        'credited', credit_amount,
        'new_balance', v_new_balance
    );
END;
$$;
