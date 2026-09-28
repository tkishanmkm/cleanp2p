-- ============================================================================
-- Supabase Migration: 20260928000000_platform_ledger_entries.sql
-- Description: Authoritative platform fee and on-chain network expense accounting ledger.
--              Corrected for live public.wallet_assets schema (user_id, asset_symbol, balance, in_withdrawal).
--              Hardened with fail-closed financial idempotency, broadcasted refund safety,
--              wallet_assets update verification, and zero silent exception swallows.
-- ============================================================================

BEGIN;

-- 1. Validate & Ensure Required Assets with Canonical Decimals
DO $$
DECLARE
    v_rec RECORD;
    v_expected_decimals INTEGER;
BEGIN
    -- Verify existing assets do not have corrupted decimals
    FOR v_rec IN 
        SELECT code, decimals FROM public.assets 
        WHERE code IN ('BTC', 'ETH', 'BNB', 'USDT', 'USDC', 'LTC', 'TRX')
    LOOP
        CASE v_rec.code
            WHEN 'BTC' THEN v_expected_decimals := 8;
            WHEN 'ETH' THEN v_expected_decimals := 18;
            WHEN 'BNB' THEN v_expected_decimals := 18;
            WHEN 'USDT' THEN v_expected_decimals := 6;
            WHEN 'USDC' THEN v_expected_decimals := 6;
            WHEN 'LTC' THEN v_expected_decimals := 8;
            WHEN 'TRX' THEN v_expected_decimals := 6;
            ELSE v_expected_decimals := v_rec.decimals;
        END CASE;

        IF v_rec.decimals <> v_expected_decimals THEN
            RAISE EXCEPTION 'Asset % decimal corruption detected: expected %, found %', 
                v_rec.code, v_expected_decimals, v_rec.decimals;
        END IF;
    END LOOP;
END $$;

-- Insert any missing canonical assets with exact decimals
INSERT INTO public.assets (code, name, decimals, is_enabled) VALUES
('BTC', 'Bitcoin', 8, true),
('ETH', 'Ethereum', 18, true),
('BNB', 'BNB Smart Chain', 18, true),
('USDT', 'Tether USD', 6, true),
('USDC', 'USD Coin', 6, false),
('LTC', 'Litecoin', 8, true),
('TRX', 'Tron', 6, true)
ON CONFLICT (code) DO NOTHING;

-- 2. Ensure withdrawals & wallet_transactions table columns exist for complete schema parity
DO $$
BEGIN
    -- Ensure columns on public.withdrawals
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'withdrawals') THEN
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS tx_hash TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS txid TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS asset TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS asset_code TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS asset_symbol TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS chain TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS network TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS network_code TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
        ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS broadcast_error TEXT;

        -- Ensure status check constraint allows 'failed'
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'withdrawals_status_check') THEN
            ALTER TABLE public.withdrawals DROP CONSTRAINT withdrawals_status_check;
            ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_check 
                CHECK (status IN ('pending', 'QUEUED', 'approved', 'processing', 'broadcasting', 'broadcasted', 'BROADCASTED', 'completed', 'failed', 'rejected', 'cancelled'));
        END IF;
    END IF;

    -- Ensure columns on public.wallet_transactions
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wallet_transactions') THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS tx_type TEXT;
        ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS fee NUMERIC(36, 18) DEFAULT 0.0;
        ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS tx_hash TEXT;
        ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 3. Create Authoritative platform_ledger_entries Table
CREATE TABLE IF NOT EXISTS public.platform_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    entry_type TEXT NOT NULL CHECK (
        entry_type IN (
            'withdrawal_fee_accrued',
            'withdrawal_fee_collected',
            'withdrawal_fee_accrual_cancelled',
            'network_gas_expense',
            'network_gas_reversal',
            'trade_fee_collected',
            'transfer_fee_collected'
        )
    ),

    asset_code TEXT NOT NULL
        REFERENCES public.assets(code)
        ON DELETE RESTRICT,

    amount NUMERIC(36,18) NOT NULL
        CHECK (amount > 0),

    direction TEXT NOT NULL
        CHECK (direction IN ('CREDIT', 'DEBIT')),

    usd_equivalent NUMERIC(20,8),

    related_user_id UUID
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    ref_table TEXT NOT NULL,
    ref_id TEXT NOT NULL,

    network_code TEXT,

    tx_hash TEXT,

    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,

    idempotency_key TEXT NOT NULL UNIQUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance & reconciliation
CREATE INDEX IF NOT EXISTS idx_pf_ledger_ref ON public.platform_ledger_entries(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_pf_ledger_entry_type ON public.platform_ledger_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_pf_ledger_asset_code ON public.platform_ledger_entries(asset_code);
CREATE INDEX IF NOT EXISTS idx_pf_ledger_tx_hash ON public.platform_ledger_entries(tx_hash);
CREATE INDEX IF NOT EXISTS idx_pf_ledger_created_at ON public.platform_ledger_entries(created_at);

-- Row Level Security
ALTER TABLE public.platform_ledger_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'platform_ledger_entries' AND policyname = 'Admins can view platform ledger'
    ) THEN
        CREATE POLICY "Admins can view platform ledger"
            ON public.platform_ledger_entries
            FOR SELECT
            USING (
                public.is_admin()
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid()
                    AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                )
            );
    END IF;
END $$;


-- 4. Concurrency-Safe Fail-Closed Platform Ledger Entry Insertion Helper
CREATE OR REPLACE FUNCTION public.record_platform_ledger_entry(
    p_entry_type TEXT,
    p_asset_code TEXT,
    p_amount NUMERIC(36, 18),
    p_direction TEXT,
    p_related_user_id UUID,
    p_ref_table TEXT,
    p_ref_id TEXT,
    p_network_code TEXT,
    p_tx_hash TEXT,
    p_idempotency_key TEXT,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing RECORD;
    v_new_id UUID;
BEGIN
    -- Strict validation of required inputs
    IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key is required for platform ledger entry';
    END IF;

    IF p_entry_type IS NULL OR TRIM(p_entry_type) = '' THEN
        RAISE EXCEPTION 'Entry type is required for platform ledger entry';
    END IF;

    IF p_asset_code IS NULL OR TRIM(p_asset_code) = '' THEN
        RAISE EXCEPTION 'Asset code is required for platform ledger entry';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Platform ledger amount must be greater than zero, received: %', p_amount;
    END IF;

    IF p_direction IS NULL OR p_direction NOT IN ('CREDIT', 'DEBIT') THEN
        RAISE EXCEPTION 'Platform ledger direction must be CREDIT or DEBIT, received: %', p_direction;
    END IF;

    -- Concurrency-safe atomic insertion loop:
    LOOP
        INSERT INTO public.platform_ledger_entries (
            entry_type,
            asset_code,
            amount,
            direction,
            related_user_id,
            ref_table,
            ref_id,
            network_code,
            tx_hash,
            idempotency_key,
            metadata
        ) VALUES (
            p_entry_type,
            p_asset_code,
            p_amount,
            p_direction,
            p_related_user_id,
            p_ref_table,
            p_ref_id,
            p_network_code,
            p_tx_hash,
            p_idempotency_key,
            COALESCE(p_metadata, '{}'::JSONB)
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id INTO v_new_id;

        IF v_new_id IS NOT NULL THEN
            RETURN v_new_id;
        END IF;

        SELECT *
        INTO v_existing
        FROM public.platform_ledger_entries
        WHERE idempotency_key = p_idempotency_key
        FOR SHARE;

        IF FOUND THEN
            IF v_existing.entry_type IS DISTINCT FROM p_entry_type
               OR v_existing.asset_code IS DISTINCT FROM p_asset_code
               OR v_existing.amount IS DISTINCT FROM p_amount
               OR v_existing.direction IS DISTINCT FROM p_direction
               OR v_existing.related_user_id IS DISTINCT FROM p_related_user_id
               OR v_existing.ref_table IS DISTINCT FROM p_ref_table
               OR v_existing.ref_id IS DISTINCT FROM p_ref_id
               OR v_existing.network_code IS DISTINCT FROM p_network_code
               OR v_existing.tx_hash IS DISTINCT FROM p_tx_hash
            THEN
                RAISE EXCEPTION
                    'Financial idempotency conflict on key %: existing entry differs from incoming event',
                    p_idempotency_key;
            END IF;

            RETURN v_existing.id;
        END IF;
    END LOOP;
END;
$$;


-- 5. Authoritative public.request_withdrawal with Strict Validation & Fail-Closed Updates
-- SECURITY BOUNDARY NOTICE:
-- This function is EXECUTE-restricted exclusively to the service_role backend client.
-- Ordinary clients (authenticated/anon) cannot call this function via PostgREST RPC.
-- All client-initiated requests must pass through trusted Next.js API routes where auth,
-- rate-limiting, and fee policies are enforced before invoking this service_role RPC.
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_balance NUMERIC(36, 18);
    v_in_withdrawal NUMERIC(36, 18);
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
    v_total_deduct NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(COALESCE(p_asset, '')));
    v_network_clean TEXT := UPPER(TRIM(COALESCE(p_network, '')));
    v_to_address_clean TEXT := TRIM(COALESCE(p_to_address, ''));
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
    v_rows INTEGER;
BEGIN
    -- Strict Input Validations
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF v_asset_clean = '' THEN
        RAISE EXCEPTION 'Asset code is required';
    END IF;

    IF v_network_clean = '' THEN
        RAISE EXCEPTION 'Network is required';
    END IF;

    IF v_to_address_clean = '' THEN
        RAISE EXCEPTION 'Destination address is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    IF p_fee IS NULL OR p_fee < 0 THEN
        RAISE EXCEPTION 'Withdrawal fee cannot be negative or null';
    END IF;

    v_total_deduct := p_amount + p_fee;
    IF v_total_deduct <= 0 THEN
        RAISE EXCEPTION 'Total withdrawal deduction must be greater than zero';
    END IF;

    -- Enforce Exact Production Asset + Network Matrix
    CASE v_asset_clean
        WHEN 'USDT' THEN
            IF v_network_clean NOT IN ('TRON', 'TRC20', 'ETHEREUM', 'ETH', 'ERC20', 'BSC', 'BEP20', 'BNB') THEN
                RAISE EXCEPTION 'Invalid network % for USDT withdrawal. Allowed: TRON, Ethereum, BSC', p_network;
            END IF;
        WHEN 'BTC' THEN
            IF v_network_clean NOT IN ('BITCOIN', 'BTC') THEN
                RAISE EXCEPTION 'Invalid network % for BTC withdrawal. Allowed: Bitcoin', p_network;
            END IF;
        WHEN 'ETH' THEN
            IF v_network_clean NOT IN ('ETHEREUM', 'ETH', 'ERC20') THEN
                RAISE EXCEPTION 'Invalid network % for ETH withdrawal. Allowed: Ethereum', p_network;
            END IF;
        WHEN 'LTC' THEN
            IF v_network_clean NOT IN ('LITECOIN', 'LTC') THEN
                RAISE EXCEPTION 'Invalid network % for LTC withdrawal. Allowed: Litecoin', p_network;
            END IF;
        ELSE
            RAISE EXCEPTION 'Asset % is not approved for production withdrawals', v_asset_clean;
    END CASE;

    -- Verify asset exists in public.assets and is enabled for withdrawals
    IF NOT EXISTS (
        SELECT 1 FROM public.assets
        WHERE code = v_asset_clean
          AND is_enabled = TRUE
    ) THEN
        RAISE EXCEPTION 'Asset % is disabled or not supported for withdrawal', v_asset_clean;
    END IF;

    -- Check user profile restrictions
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_on_hold, FALSE)
    INTO v_is_banned, v_is_on_hold
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile record not found for user %', p_user_id;
    END IF;

    IF v_is_banned OR v_is_on_hold THEN
        RAISE EXCEPTION 'Account is restricted from executing withdrawals.';
    END IF;

    -- Find or provision wallet
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

    -- Lock wallet_assets row for update using live schema (user_id, asset_symbol)
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

    -- 1. Deduct directly from spendable balance and credit in_withdrawal lock using live schema
    UPDATE public.wallet_assets
    SET balance = balance - v_total_deduct,
        in_withdrawal = in_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND asset_symbol = v_asset_clean
      AND balance >= v_total_deduct
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Authoritative wallet_assets record not found or could not be updated for user % and asset %: updated % rows',
            p_user_id, v_asset_clean, v_rows;
    END IF;

    -- 2. Insert into public.wallet_transactions
    INSERT INTO public.wallet_transactions (
        id,
        user_id,
        type,
        tx_type,
        network,
        asset_symbol,
        amount,
        fee,
        from_address,
        to_address,
        status,
        created_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        'WITHDRAWAL',
        'WITHDRAWAL',
        v_network_clean,
        v_asset_clean,
        p_amount,
        p_fee,
        'Platform Hot Wallet',
        v_to_address_clean,
        'PENDING',
        NOW()
    );

    -- 3. Insert into public.withdrawals table
    INSERT INTO public.withdrawals (
        id,
        user_id,
        wallet_id,
        asset_code,
        asset,
        network_code,
        chain,
        destination_address,
        amount,
        network_fee,
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
        v_network_clean,
        v_network_clean,
        v_to_address_clean,
        p_amount,
        p_fee,
        'pending',
        'w_' || v_withdrawal_id::TEXT,
        NOW(),
        NOW()
    );

    -- 4. Insert into public.onchain_withdrawals queue
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
        created_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_wallet_id,
        v_to_address_clean,
        p_amount,
        v_asset_clean,
        v_network_clean,
        'PENDING',
        jsonb_build_object('fee', p_fee, 'total_deducted', v_total_deduct),
        NOW()
    );

    -- 5. Record Immutable User Ledger Entry
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
        v_wallet_id,
        p_user_id,
        v_asset_clean,
        -v_total_deduct,
        +v_total_deduct,
        v_balance_after,
        v_in_withdrawal_after,
        'withdrawal_lock',
        'withdrawals',
        v_withdrawal_id::TEXT,
        'wlock_' || v_withdrawal_id::TEXT
    );

    -- 6. Record Platform Fee Accrual (Fail-Closed Idempotency)
    IF p_fee > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'withdrawal_fee_accrued',
            p_asset_code := v_asset_clean,
            p_amount := p_fee,
            p_direction := 'CREDIT',
            p_related_user_id := p_user_id,
            p_ref_table := 'onchain_withdrawals',
            p_ref_id := v_withdrawal_id::TEXT,
            p_network_code := v_network_clean,
            p_tx_hash := NULL,
            p_idempotency_key := 'pf_fee_acc_' || v_withdrawal_id::TEXT,
            p_metadata := jsonb_build_object('recipient_amount', p_amount, 'total_deducted', v_total_deduct)
        );
    END IF;

    RETURN v_withdrawal_id;
END;
$$;


-- 6. Drop Legacy 2-Argument Signatures to Prevent Ambiguous Overloads
DROP FUNCTION IF EXISTS public.complete_onchain_withdrawal(UUID, TEXT);
DROP FUNCTION IF EXISTS public.process_failed_withdrawal(UUID, TEXT);


-- 7. Canonical complete_onchain_withdrawal with Fail-Closed Wallet Update & Idempotency
CREATE OR REPLACE FUNCTION public.complete_onchain_withdrawal(
    p_withdrawal_id UUID,
    p_tx_hash TEXT,
    p_actual_gas_amount NUMERIC(36, 18) DEFAULT 0.0,
    p_gas_asset TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_total_deducted NUMERIC(36, 18);
    v_fee NUMERIC(36, 18) := 0;
    v_metadata_total NUMERIC(36, 18);
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
    v_gas_asset_clean TEXT;
    v_tx_hash_clean TEXT;
    v_rows INTEGER;
BEGIN
    -- 1. Input validations
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    v_tx_hash_clean := TRIM(COALESCE(p_tx_hash, ''));
    IF v_tx_hash_clean = '' THEN
        RAISE EXCEPTION 'Transaction hash is required to complete withdrawal';
    END IF;

    SELECT *
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- Strict Gas Input Validation & Network Mapping Verification
    IF p_actual_gas_amount IS NOT NULL AND p_actual_gas_amount < 0 THEN
        RAISE EXCEPTION 'Actual gas amount cannot be negative, received: %', p_actual_gas_amount;
    END IF;

    IF COALESCE(p_actual_gas_amount, 0) > 0 THEN
        IF p_gas_asset IS NULL OR TRIM(p_gas_asset) = '' THEN
            RAISE EXCEPTION 'Gas asset is required when actual gas amount is greater than zero';
        END IF;

        v_gas_asset_clean := UPPER(TRIM(p_gas_asset));

        -- Fail closed if gas asset is not a registered asset in public.assets
        IF NOT EXISTS (SELECT 1 FROM public.assets WHERE code = v_gas_asset_clean) THEN
            RAISE EXCEPTION 'Gas asset % is not a registered asset in public.assets', v_gas_asset_clean;
        END IF;

        -- Strict Network to Gas Asset Mapping Enforcement
        CASE UPPER(TRIM(COALESCE(v_withdrawal.network, '')))
            WHEN 'TRON', 'TRC20' THEN
                IF v_gas_asset_clean <> 'TRX' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for TRON network withdrawal %: expected TRX, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'ETHEREUM', 'ETH', 'ERC20' THEN
                IF v_gas_asset_clean <> 'ETH' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Ethereum network withdrawal %: expected ETH, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'BSC', 'BEP20', 'BNB' THEN
                IF v_gas_asset_clean <> 'BNB' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for BSC network withdrawal %: expected BNB, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'BITCOIN', 'BTC' THEN
                IF v_gas_asset_clean <> 'BTC' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Bitcoin network withdrawal %: expected BTC, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'LITECOIN', 'LTC' THEN
                IF v_gas_asset_clean <> 'LTC' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Litecoin network withdrawal %: expected LTC, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            ELSE
                RAISE EXCEPTION 'Unrecognized network % for gas asset validation on withdrawal %',
                    v_withdrawal.network, p_withdrawal_id;
        END CASE;
    END IF;

    -- Authoritative Principal Amount Validation
    IF v_withdrawal.amount IS NULL OR v_withdrawal.amount <= 0 THEN
        RAISE EXCEPTION 'Corrupted withdrawal %: principal amount must be greater than zero, found: %',
            p_withdrawal_id, v_withdrawal.amount;
    END IF;

    -- 2. State Machine Enforcement
    -- Idempotency check: If already CONFIRMED or COMPLETED:
    IF v_withdrawal.status IN ('CONFIRMED', 'COMPLETED') THEN
        IF v_withdrawal.tx_hash IS NULL OR TRIM(v_withdrawal.tx_hash) = '' THEN
            RAISE EXCEPTION 'Financial state corruption: withdrawal % is marked % but lacks stored transaction hash',
                p_withdrawal_id, v_withdrawal.status;
        END IF;

        IF TRIM(v_withdrawal.tx_hash) IS DISTINCT FROM v_tx_hash_clean THEN
            RAISE EXCEPTION 'Financial idempotency conflict: withdrawal % already confirmed with tx_hash %, but caller supplied differing tx_hash %',
                p_withdrawal_id, v_withdrawal.tx_hash, v_tx_hash_clean;
        END IF;

        RETURN jsonb_build_object('success', true, 'message', 'Already confirmed');
    END IF;

    -- Terminal states cannot complete
    IF v_withdrawal.status IN ('FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Cannot complete withdrawal % in terminal state %', p_withdrawal_id, v_withdrawal.status;
    END IF;

    -- Pre-broadcast states cannot complete
    IF v_withdrawal.status IN ('NEEDS_APPROVAL', 'PENDING', 'PROCESSING') THEN
        RAISE EXCEPTION 'Cannot complete withdrawal % in state %: must be BROADCASTED first',
            p_withdrawal_id, v_withdrawal.status;
    END IF;

    -- Fail-closed against any unexpected state
    IF v_withdrawal.status <> 'BROADCASTED' THEN
        RAISE EXCEPTION 'Cannot complete withdrawal % in invalid state %', p_withdrawal_id, v_withdrawal.status;
    END IF;

    -- Valid broadcasted withdrawal must have a non-empty tx_hash recorded
    IF v_withdrawal.tx_hash IS NULL OR TRIM(v_withdrawal.tx_hash) = '' THEN
        RAISE EXCEPTION 'Cannot complete withdrawal %: onchain_withdrawals record lacks broadcast tx_hash', p_withdrawal_id;
    END IF;

    -- Verify caller tx_hash matches the broadcasted tx_hash
    IF TRIM(v_withdrawal.tx_hash) <> v_tx_hash_clean THEN
        RAISE EXCEPTION 'Transaction hash mismatch for withdrawal %: record has %, caller provided %',
            p_withdrawal_id, v_withdrawal.tx_hash, v_tx_hash_clean;
    END IF;

    -- Strict Fee Parsing & Validation
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
        BEGIN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid withdrawal fee format for withdrawal %: failed to parse fee %',
                p_withdrawal_id, v_withdrawal.metadata->>'fee';
        END;
    END IF;

    IF v_fee IS NULL OR v_fee < 0 THEN
        RAISE EXCEPTION 'Invalid withdrawal fee for withdrawal %: fee cannot be null or negative, found: %',
            p_withdrawal_id, v_fee;
    END IF;

    -- Authoritative Total Computation (Principal + Fee)
    v_total_deducted := v_withdrawal.amount + v_fee;

    -- Metadata total_deducted Integrity Check (Validation Only)
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        BEGIN
            v_metadata_total := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid total_deducted format in metadata for withdrawal %: failed to parse %',
                p_withdrawal_id, v_withdrawal.metadata->>'total_deducted';
        END;

        IF v_metadata_total IS NULL OR v_metadata_total IS DISTINCT FROM v_total_deducted THEN
            RAISE EXCEPTION 'Financial metadata integrity mismatch for withdrawal %: metadata total % does not match expected authoritative total % (principal % + fee %)',
                p_withdrawal_id, v_metadata_total, v_total_deducted, v_withdrawal.amount, v_fee;
        END IF;
    END IF;

    -- 1. Release in_withdrawal liability using live schema (user_id, asset_symbol) (FAIL-CLOSED)
    UPDATE public.wallet_assets
    SET in_withdrawal = in_withdrawal - v_total_deducted,
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id
      AND asset_symbol = v_withdrawal.asset_symbol
      AND in_withdrawal >= v_total_deducted
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Insufficient in_withdrawal balance for user % and asset %: required %, in_withdrawal balance insufficient (updated % rows)',
            v_withdrawal.user_id, v_withdrawal.asset_symbol, v_total_deducted, v_rows;
    END IF;

    -- 2. Mark queue status as CONFIRMED
    UPDATE public.onchain_withdrawals
    SET status = 'CONFIRMED',
        tx_hash = v_tx_hash_clean,
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update onchain_withdrawals status to CONFIRMED for withdrawal %: row count %',
            p_withdrawal_id, v_rows;
    END IF;

    -- 3. Update withdrawals table (authoritative sync, fail-closed)
    UPDATE public.withdrawals
    SET status = 'completed',
        tx_hash = v_tx_hash_clean,
        txid = v_tx_hash_clean,
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update public.withdrawals mirror to completed for withdrawal %: expected exactly 1 row, updated %',
            p_withdrawal_id, v_rows;
    END IF;

    -- Also update wallet_transactions (authoritative sync, fail-closed)
    UPDATE public.wallet_transactions
    SET status = 'COMPLETED',
        tx_hash = v_tx_hash_clean,
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update wallet_transactions mirror to COMPLETED for withdrawal %: expected exactly 1 row, updated %',
            p_withdrawal_id, v_rows;
    END IF;

    -- 4. Insert user ledger completion entry
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
        'onchain_withdrawals',
        p_withdrawal_id::TEXT,
        'wcomp_' || p_withdrawal_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 5. Platform Accounting 1: Realize collected fee revenue (FAIL-CLOSED IDEMPOTENCY)
    IF COALESCE(v_fee, 0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'withdrawal_fee_collected',
            p_asset_code := v_withdrawal.asset_symbol,
            p_amount := v_fee,
            p_direction := 'CREDIT',
            p_related_user_id := v_withdrawal.user_id,
            p_ref_table := 'onchain_withdrawals',
            p_ref_id := p_withdrawal_id::TEXT,
            p_network_code := v_withdrawal.network,
            p_tx_hash := v_tx_hash_clean,
            p_idempotency_key := 'pf_fee_col_' || p_withdrawal_id::TEXT,
            p_metadata := jsonb_build_object('recipient_amount', v_withdrawal.amount, 'total_deducted', v_total_deducted)
        );
    END IF;

    -- 6. Platform Accounting 2: Record actual network gas/miner expense (FAIL-CLOSED IDEMPOTENCY)
    IF COALESCE(p_actual_gas_amount, 0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'network_gas_expense',
            p_asset_code := v_gas_asset_clean,
            p_amount := p_actual_gas_amount,
            p_direction := 'DEBIT',
            p_related_user_id := v_withdrawal.user_id,
            p_ref_table := 'onchain_withdrawals',
            p_ref_id := p_withdrawal_id::TEXT,
            p_network_code := v_withdrawal.network,
            p_tx_hash := v_tx_hash_clean,
            p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::TEXT,
            p_metadata := jsonb_build_object('gas_asset', v_gas_asset_clean, 'gas_amount', p_actual_gas_amount)
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'CONFIRMED'
    );
END;
$$;


-- 8. Canonical process_failed_withdrawal with Broadcasted Refund Safety & Fail-Closed Updates
CREATE OR REPLACE FUNCTION public.process_failed_withdrawal(
    p_withdrawal_id UUID,
    p_error_reason TEXT,
    p_actual_gas_amount NUMERIC(36, 18) DEFAULT 0.0,
    p_gas_asset TEXT DEFAULT NULL,
    p_is_verified_revert BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_fee NUMERIC(36, 18) := 0;
    v_total_refund NUMERIC(36, 18);
    v_metadata_total NUMERIC(36, 18);
    v_balance_after NUMERIC(36, 18);
    v_in_withdrawal_after NUMERIC(36, 18);
    v_gas_asset_clean TEXT;
    v_rows INTEGER;
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    -- Lookup onchain_withdrawals record
    SELECT id, user_id, wallet_id, amount, asset_symbol, network, status, tx_hash, metadata
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF v_withdrawal.id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- Strict Gas Input Validation & Network Mapping Verification
    IF p_actual_gas_amount IS NOT NULL AND p_actual_gas_amount < 0 THEN
        RAISE EXCEPTION 'Actual gas amount cannot be negative, received: %', p_actual_gas_amount;
    END IF;

    IF NOT p_is_verified_revert AND COALESCE(p_actual_gas_amount, 0) > 0 THEN
        RAISE EXCEPTION 'Cannot record network gas expense for unverified/pre-broadcast withdrawal failure';
    END IF;

    IF COALESCE(p_actual_gas_amount, 0) > 0 THEN
        IF p_gas_asset IS NULL OR TRIM(p_gas_asset) = '' THEN
            RAISE EXCEPTION 'Gas asset is required when actual gas amount is greater than zero';
        END IF;

        v_gas_asset_clean := UPPER(TRIM(p_gas_asset));

        -- Fail closed if gas asset is not a registered asset in public.assets
        IF NOT EXISTS (SELECT 1 FROM public.assets WHERE code = v_gas_asset_clean) THEN
            RAISE EXCEPTION 'Gas asset % is not a registered asset in public.assets', v_gas_asset_clean;
        END IF;

        -- Strict Network to Gas Asset Mapping Enforcement
        CASE UPPER(TRIM(COALESCE(v_withdrawal.network, '')))
            WHEN 'TRON', 'TRC20' THEN
                IF v_gas_asset_clean <> 'TRX' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for TRON network withdrawal %: expected TRX, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'ETHEREUM', 'ETH', 'ERC20' THEN
                IF v_gas_asset_clean <> 'ETH' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Ethereum network withdrawal %: expected ETH, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'BSC', 'BEP20', 'BNB' THEN
                IF v_gas_asset_clean <> 'BNB' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for BSC network withdrawal %: expected BNB, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'BITCOIN', 'BTC' THEN
                IF v_gas_asset_clean <> 'BTC' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Bitcoin network withdrawal %: expected BTC, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            WHEN 'LITECOIN', 'LTC' THEN
                IF v_gas_asset_clean <> 'LTC' THEN
                    RAISE EXCEPTION 'Gas asset mismatch for Litecoin network withdrawal %: expected LTC, received %',
                        p_withdrawal_id, v_gas_asset_clean;
                END IF;
            ELSE
                RAISE EXCEPTION 'Unrecognized network % for gas asset validation on withdrawal %',
                    v_withdrawal.network, p_withdrawal_id;
        END CASE;
    END IF;

    -- Authoritative Principal Amount Validation
    IF v_withdrawal.amount IS NULL OR v_withdrawal.amount <= 0 THEN
        RAISE EXCEPTION 'Corrupted withdrawal %: principal amount must be greater than zero, found: %',
            p_withdrawal_id, v_withdrawal.amount;
    END IF;

    -- Idempotency check: If already failed, exit safely
    IF v_withdrawal.status IN ('FAILED', 'CANCELLED') THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already marked as failed');
    END IF;

    -- Never refund a completed or confirmed withdrawal
    IF v_withdrawal.status IN ('CONFIRMED', 'COMPLETED') THEN
        RAISE EXCEPTION 'Cannot refund completed withdrawal %', p_withdrawal_id;
    END IF;

    -- BROADCASTED / BROADCASTING REFUND SAFETY GUARD:
    -- If a transaction was already broadcast or is currently broadcasting on-chain
    -- (status IN ('BROADCASTED', 'BROADCASTING') OR tx_hash IS NOT NULL AND TRIM(tx_hash) <> ''),
    -- generic worker/admin errors MUST NOT refund it unless verified on-chain revert evidence is provided.
    IF (v_withdrawal.status IN ('BROADCASTED', 'BROADCASTING') OR (v_withdrawal.tx_hash IS NOT NULL AND TRIM(v_withdrawal.tx_hash) <> '')) THEN
        IF NOT p_is_verified_revert THEN
            RAISE EXCEPTION 'Cannot refund broadcasted or broadcasting withdrawal % (status: %, tx: %) without verified on-chain failure evidence',
                p_withdrawal_id, v_withdrawal.status, COALESCE(v_withdrawal.tx_hash, 'NONE');
        END IF;

        IF v_withdrawal.tx_hash IS NULL OR TRIM(v_withdrawal.tx_hash) = '' THEN
            RAISE EXCEPTION 'Cannot process verified revert for withdrawal % in status % without valid transaction hash',
                p_withdrawal_id, v_withdrawal.status;
        END IF;
    ELSE
        -- Pre-broadcast failure (NEEDS_APPROVAL, PENDING, PROCESSING with no tx_hash)
        IF p_is_verified_revert THEN
            RAISE EXCEPTION 'Cannot claim verified on-chain revert for unbroadcasted withdrawal % (status: %)',
                p_withdrawal_id, v_withdrawal.status;
        END IF;
    END IF;

    -- Strict Fee Parsing & Validation
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
        BEGIN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid withdrawal fee format for withdrawal %: failed to parse fee %',
                p_withdrawal_id, v_withdrawal.metadata->>'fee';
        END;
    END IF;

    IF v_fee IS NULL OR v_fee < 0 THEN
        RAISE EXCEPTION 'Invalid withdrawal fee for withdrawal %: fee cannot be null or negative, found: %',
            p_withdrawal_id, v_fee;
    END IF;

    -- Authoritative Total Refund Computation (Principal + Fee)
    v_total_refund := v_withdrawal.amount + v_fee;

    -- Metadata total_deducted Integrity Check (Validation Only)
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        BEGIN
            v_metadata_total := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid total_deducted format in metadata for withdrawal %: failed to parse %',
                p_withdrawal_id, v_withdrawal.metadata->>'total_deducted';
        END;

        IF v_metadata_total IS NULL OR v_metadata_total IS DISTINCT FROM v_total_refund THEN
            RAISE EXCEPTION 'Financial metadata integrity mismatch for withdrawal %: metadata total % does not match expected authoritative total % (principal % + fee %)',
                p_withdrawal_id, v_metadata_total, v_total_refund, v_withdrawal.amount, v_fee;
        END IF;
    END IF;

    -- 1. Credit balance and release in_withdrawal using live schema (user_id, asset_symbol) (FAIL-CLOSED)
    UPDATE public.wallet_assets
    SET balance = balance + v_total_refund,
        in_withdrawal = in_withdrawal - v_total_refund,
        updated_at = NOW()
    WHERE user_id = v_withdrawal.user_id
      AND asset_symbol = v_withdrawal.asset_symbol
      AND in_withdrawal >= v_total_refund
    RETURNING balance, in_withdrawal INTO v_balance_after, v_in_withdrawal_after;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Insufficient in_withdrawal balance for user % and asset %: refund % exceeds in_withdrawal balance (updated % rows)',
            v_withdrawal.user_id, v_withdrawal.asset_symbol, v_total_refund, v_rows;
    END IF;

    -- 2. Mark queue status as FAILED
    UPDATE public.onchain_withdrawals
    SET status = 'FAILED',
        error_message = COALESCE(p_error_reason, 'Withdrawal processing failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update onchain_withdrawals status to FAILED for withdrawal %: row count %',
            p_withdrawal_id, v_rows;
    END IF;

    -- 3. Update withdrawals table (authoritative sync, fail-closed)
    UPDATE public.withdrawals
    SET status = 'failed',
        rejected_reason = COALESCE(p_error_reason, 'Withdrawal processing failure'),
        broadcast_error = COALESCE(p_error_reason, 'Withdrawal processing failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update public.withdrawals mirror to failed for withdrawal %: expected exactly 1 row, updated %',
            p_withdrawal_id, v_rows;
    END IF;

    -- Also update wallet_transactions (authoritative sync, fail-closed)
    UPDATE public.wallet_transactions
    SET status = 'FAILED',
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'Failed to update wallet_transactions mirror to FAILED for withdrawal %: expected exactly 1 row, updated %',
            p_withdrawal_id, v_rows;
    END IF;

    -- 4. Record refund ledger entry
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
        'onchain_withdrawals',
        p_withdrawal_id::TEXT,
        'wrefund_' || p_withdrawal_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 5. Platform Accounting 1: Cancel fee accrual (DEBIT - FAIL-CLOSED IDEMPOTENCY)
    IF COALESCE(v_fee, 0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'withdrawal_fee_accrual_cancelled',
            p_asset_code := v_withdrawal.asset_symbol,
            p_amount := v_fee,
            p_direction := 'DEBIT',
            p_related_user_id := v_withdrawal.user_id,
            p_ref_table := 'onchain_withdrawals',
            p_ref_id := p_withdrawal_id::TEXT,
            p_network_code := v_withdrawal.network,
            p_tx_hash := v_withdrawal.tx_hash,
            p_idempotency_key := 'pf_fee_ref_' || p_withdrawal_id::TEXT,
            p_metadata := jsonb_build_object('refunded_principal', v_withdrawal.amount, 'refunded_fee', v_fee, 'reason', p_error_reason)
        );
    END IF;

    -- 6. Platform Accounting 2: Post-broadcast verified revert retains burned on-chain gas expense
    -- (tx_hash IS NOT NULL AND p_is_verified_revert = TRUE indicates on-chain gas was permanently consumed)
    IF v_withdrawal.tx_hash IS NOT NULL AND p_is_verified_revert AND COALESCE(p_actual_gas_amount, 0) > 0 THEN
        PERFORM public.record_platform_ledger_entry(
            p_entry_type := 'network_gas_expense',
            p_asset_code := v_gas_asset_clean,
            p_amount := p_actual_gas_amount,
            p_direction := 'DEBIT',
            p_related_user_id := v_withdrawal.user_id,
            p_ref_table := 'onchain_withdrawals',
            p_ref_id := p_withdrawal_id::TEXT,
            p_network_code := v_withdrawal.network,
            p_tx_hash := v_withdrawal.tx_hash,
            p_idempotency_key := 'pf_gas_exp_' || p_withdrawal_id::TEXT,
            p_metadata := jsonb_build_object('gas_asset', v_gas_asset_clean, 'gas_amount', p_actual_gas_amount, 'stage', 'post_broadcast_revert')
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'refunded_amount', v_total_refund,
        'status', 'FAILED'
    );
END;
$$;


-- 9. Explicit EXECUTE Privilege Hardening for Trusted Backend Service Role Only
REVOKE EXECUTE ON FUNCTION public.record_platform_ledger_entry(TEXT, TEXT, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.record_platform_ledger_entry(TEXT, TEXT, NUMERIC, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_onchain_withdrawal(UUID, TEXT, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_failed_withdrawal(UUID, TEXT, NUMERIC, TEXT, BOOLEAN) TO service_role;

COMMIT;
