-- ============================================================================
-- Supabase Migration: 20260909000000_hardened_core_rpcs.sql
-- Description: Defines exact hardened RPC functions matching application routes:
--              1. process_incoming_deposit(p_to_address, p_asset, p_network, p_amount, p_txid, p_output_index)
--              2. process_external_withdrawal(p_user_id, p_asset, p_destination, p_amount)
--              3. execute_internal_transfer(p_sender_id, p_recipient_username, p_asset, p_gross_amount)
-- ============================================================================

-- Drop existing functions to allow parameter renaming and avoid 42P13 errors
DROP FUNCTION IF EXISTS public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, NUMERIC);
DROP FUNCTION IF EXISTS public.process_incoming_deposit(TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.process_incoming_deposit(TEXT, TEXT, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.process_external_withdrawal(UUID, TEXT, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.process_external_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC);

-- Ensure MFA columns exist on profiles
ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS is_mfa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS security_answer_hash TEXT,
  ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;

-- ----------------------------------------------------------------------------
-- 1. PROCESS INCOMING DEPOSIT (Atomic, Idempotent, Prevents Replay Attacks)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_incoming_deposit(
    p_to_address TEXT,
    p_asset TEXT,
    p_network TEXT,
    p_amount NUMERIC,
    p_txid TEXT,
    p_output_index INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_wallet_id UUID;
    v_deposit_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_network_clean TEXT := UPPER(TRIM(p_network));
    v_clean_address TEXT := LOWER(TRIM(p_to_address));
    v_new_balance NUMERIC(36, 18);
BEGIN
    -- 1. Check for Replay / Already Processed Deposit
    IF EXISTS (
        SELECT 1 FROM public.deposits 
        WHERE txid = p_txid AND output_index = p_output_index
    ) OR EXISTS (
        SELECT 1 FROM public.blockchain_transactions
        WHERE txid = p_txid AND output_index = p_output_index
    ) OR EXISTS (
        SELECT 1 FROM public.onchain_deposits
        WHERE (tx_hash = p_txid OR txid = p_txid) AND log_index = p_output_index
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'code', 'ALREADY_PROCESSED',
            'message', 'Transaction has already been credited'
        );
    END IF;

    -- 2. Resolve User ID from Custodial Deposit Addresses
    SELECT user_id, wallet_id INTO v_user_id, v_wallet_id
    FROM public.deposit_addresses
    WHERE LOWER(address) = v_clean_address
    LIMIT 1;

    -- Fallback: check wallets or profiles table
    IF v_user_id IS NULL THEN
        SELECT user_id, id INTO v_user_id, v_wallet_id
        FROM public.wallets
        WHERE LOWER(address) = v_clean_address
        LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id
        FROM public.profiles
        WHERE LOWER(deposit_address_eth) = v_clean_address 
           OR LOWER(deposit_address_btc) = v_clean_address 
           OR LOWER(deposit_address_ltc) = v_clean_address 
           OR LOWER(deposit_address_trx) = v_clean_address
        LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ADDRESS_NOT_FOUND',
            'error', 'Deposit address not associated with any active user account'
        );
    END IF;

    -- 3. Ensure User Wallet Exists
    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_user_id
        LIMIT 1;

        IF v_wallet_id IS NULL THEN
            INSERT INTO public.wallets (user_id, status, provisioning_status)
            VALUES (v_user_id, 'active', 'completed')
            RETURNING id INTO v_wallet_id;
        END IF;
    END IF;

    -- 4. Record Deposit Record (Idempotent)
    INSERT INTO public.deposits (
        user_id,
        wallet_id,
        asset_code,
        network_code,
        amount,
        txid,
        output_index,
        confirmations,
        status,
        credited_at,
        idempotency_key
    )
    VALUES (
        v_user_id,
        v_wallet_id,
        v_asset_clean,
        v_network_clean,
        p_amount,
        p_txid,
        p_output_index,
        1,
        'credited',
        NOW(),
        'dep_' || p_txid || '_' || p_output_index::TEXT
    )
    RETURNING id INTO v_deposit_id;

    -- Also record into blockchain_transactions for audit trail
    INSERT INTO public.blockchain_transactions (
        network_code, txid, output_index, to_address, asset_code, amount, confirmations, direction
    )
    VALUES (
        v_network_clean, p_txid, p_output_index, p_to_address, v_asset_clean, p_amount, 1, 'incoming'
    )
    ON CONFLICT (network_code, txid, output_index) DO NOTHING;

    -- 5. Credit Available Balance Atomically
    INSERT INTO public.wallet_assets (
        wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at
    )
    VALUES (
        v_wallet_id, v_asset_clean, p_amount, 0, 0, NOW()
    )
    ON CONFLICT (wallet_id, asset_code)
    DO UPDATE SET
        available = public.wallet_assets.available + EXCLUDED.available,
        updated_at = NOW()
    RETURNING available INTO v_new_balance;

    -- Dual-ledger sync if users table exists
    IF v_asset_clean = 'USDT' THEN
        BEGIN
            UPDATE public.users 
            SET balance_usdt = COALESCE(balance_usdt, 0) + p_amount
            WHERE id = v_user_id;
        EXCEPTION WHEN undefined_table OR undefined_column THEN
            NULL;
        END;
    END IF;

    -- 6. Insert Ledger Entry
    INSERT INTO public.ledger_entries (
        wallet_id, user_id, asset_code, delta_available, delta_locked,
        available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
        v_wallet_id, v_user_id, v_asset_clean, p_amount, 0,
        v_new_balance, 0, 'deposit_credit', 'deposits', v_deposit_id::TEXT,
        'ledger_dep_' || p_txid || '_' || p_output_index::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'deposit_id', v_deposit_id,
        'user_id', v_user_id,
        'asset', v_asset_clean,
        'amount', p_amount,
        'new_balance', v_new_balance
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. PROCESS EXTERNAL WITHDRAWAL (Atomic balance lock & queue)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_external_withdrawal(
    p_user_id UUID,
    p_asset TEXT,
    p_destination TEXT,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_available NUMERIC(36, 18);
    v_locked NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
    v_kill_switch BOOLEAN := FALSE;
    v_withdrawals_enabled BOOLEAN := TRUE;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    -- Check platform global kill switch
    SELECT COALESCE(global_kill_switch_active, FALSE), COALESCE(withdrawals_enabled, TRUE)
    INTO v_kill_switch, v_withdrawals_enabled
    FROM public.platform_settings
    WHERE id = 1;

    IF v_kill_switch OR NOT v_withdrawals_enabled THEN
        RAISE EXCEPTION 'Withdrawals are temporarily disabled for system maintenance.';
    END IF;

    -- Check user profile restrictions
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_on_hold, FALSE)
    INTO v_is_banned, v_is_on_hold
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_banned OR v_is_on_hold THEN
        RAISE EXCEPTION 'Your account is restricted from executing withdrawals.';
    END IF;

    -- Resolve wallet
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user';
    END IF;

    -- Lock wallet_assets row with FOR UPDATE
    SELECT available, locked_withdrawal
    INTO v_available, v_locked
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_clean
    FOR UPDATE;

    IF v_available IS NULL OR v_available < p_amount THEN
        RAISE EXCEPTION 'Insufficient % balance. Available: %, Requested: %',
            v_asset_clean, COALESCE(v_available, 0), p_amount;
    END IF;

    -- Atomically deduct available balance and lock in locked_withdrawal
    UPDATE public.wallet_assets
    SET available = available - p_amount,
        locked_withdrawal = locked_withdrawal + p_amount,
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_clean;

    -- Insert into withdrawals table
    INSERT INTO public.withdrawals (
        user_id,
        wallet_id,
        asset_symbol,
        asset_code,
        amount,
        destination_address,
        network,
        network_code,
        status,
        created_at,
        updated_at
    )
    VALUES (
        p_user_id,
        v_wallet_id,
        v_asset_clean,
        v_asset_clean,
        p_amount,
        TRIM(p_destination),
        v_asset_clean,
        v_asset_clean,
        'QUEUED',
        NOW(),
        NOW()
    )
    RETURNING id INTO v_withdrawal_id;

    -- Insert ledger entry
    INSERT INTO public.ledger_entries (
        wallet_id, user_id, asset_code, delta_available, delta_locked,
        available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
        v_wallet_id, p_user_id, v_asset_clean, -p_amount, p_amount,
        v_available - p_amount, v_locked + p_amount, 'withdrawal_lock', 'withdrawals', v_withdrawal_id::TEXT,
        'ledger_wlock_' || v_withdrawal_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'amount', p_amount,
        'asset', v_asset_clean,
        'destination', p_destination,
        'status', 'QUEUED'
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. EXECUTE INTERNAL TRANSFER (1.5% platform fee, atomic balance mutation)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
    p_sender_id UUID,
    p_recipient_username TEXT,
    p_asset TEXT,
    p_gross_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_recipient_id UUID;
    v_sender_wallet_id UUID;
    v_recipient_wallet_id UUID;
    v_clean_username TEXT := LOWER(TRIM(p_recipient_username));
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_fee_amount NUMERIC(36, 18);
    v_net_amount NUMERIC(36, 18);
    v_sender_avail NUMERIC(36, 18);
    v_transfer_id UUID;
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
BEGIN
    IF p_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ID is required');
    END IF;

    IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transfer amount must be greater than zero');
    END IF;

    -- Check sender account status
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_on_hold, FALSE)
    INTO v_is_banned, v_is_on_hold
    FROM public.profiles
    WHERE id = p_sender_id;

    IF v_is_banned OR v_is_on_hold THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account is restricted from executing transfers.');
    END IF;

    -- Resolve Recipient by username
    SELECT id INTO v_recipient_id
    FROM public.profiles
    WHERE LOWER(username) = v_clean_username OR LOWER(email) = v_clean_username
    LIMIT 1;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient @' || p_recipient_username || ' not found');
    END IF;

    IF v_recipient_id = p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot transfer funds to yourself');
    END IF;

    -- Calculate 1.5% platform fee
    v_fee_amount := ROUND((p_gross_amount * 0.015)::numeric, 8);
    v_net_amount := p_gross_amount - v_fee_amount;

    -- Resolve sender wallet
    SELECT id INTO v_sender_wallet_id
    FROM public.wallets
    WHERE user_id = p_sender_id
    LIMIT 1;

    IF v_sender_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (p_sender_id, 'active', 'completed')
        RETURNING id INTO v_sender_wallet_id;
    END IF;

    -- Resolve recipient wallet
    SELECT id INTO v_recipient_wallet_id
    FROM public.wallets
    WHERE user_id = v_recipient_id
    LIMIT 1;

    IF v_recipient_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (v_recipient_id, 'active', 'completed')
        RETURNING id INTO v_recipient_wallet_id;
    END IF;

    -- Lock sender wallet_assets row with FOR UPDATE
    SELECT available INTO v_sender_avail
    FROM public.wallet_assets
    WHERE wallet_id = v_sender_wallet_id AND asset_code = v_asset_clean
    FOR UPDATE;

    IF v_sender_avail IS NULL OR v_sender_avail < p_gross_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient ' || v_asset_clean || ' balance for transfer and 1.5% fee'
        );
    END IF;

    -- 1. Deduct Gross Amount from Sender
    UPDATE public.wallet_assets
    SET available = available - p_gross_amount,
        updated_at = NOW()
    WHERE wallet_id = v_sender_wallet_id AND asset_code = v_asset_clean;

    -- 2. Credit Net Amount to Recipient
    INSERT INTO public.wallet_assets (
        wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at
    )
    VALUES (
        v_recipient_wallet_id, v_asset_clean, v_net_amount, 0, 0, NOW()
    )
    ON CONFLICT (wallet_id, asset_code)
    DO UPDATE SET
        available = public.wallet_assets.available + v_net_amount,
        updated_at = NOW();

    -- Generate Transfer ID
    v_transfer_id := gen_random_uuid();

    -- 3. Record in transfers table
    BEGIN
        INSERT INTO public.transfers (
            id, sender_id, recipient_id, sender_wallet_id, recipient_wallet_id,
            asset_code, gross_amount, net_amount, fee_amount, fee_rate, status, created_at
        )
        VALUES (
            v_transfer_id, p_sender_id, v_recipient_id, v_sender_wallet_id, v_recipient_wallet_id,
            v_asset_clean, p_gross_amount, v_net_amount, v_fee_amount, 0.015, 'completed', NOW()
        );
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;

    -- 4. Record Double-Entry Ledgers
    INSERT INTO public.ledger_entries (
        wallet_id, user_id, asset_code, delta_available, delta_locked,
        available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
        v_sender_wallet_id, p_sender_id, v_asset_clean, -p_gross_amount, 0,
        v_sender_avail - p_gross_amount, 0, 'internal_transfer_debit', 'transfers', v_transfer_id::TEXT,
        'ledger_tx_dr_' || v_transfer_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    INSERT INTO public.ledger_entries (
        wallet_id, user_id, asset_code, delta_available, delta_locked,
        available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key
    )
    VALUES (
        v_recipient_wallet_id, v_recipient_id, v_asset_clean, v_net_amount, 0,
        v_net_amount, 0, 'internal_transfer_credit', 'transfers', v_transfer_id::TEXT,
        'ledger_tx_cr_' || v_transfer_id::TEXT
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 5. Create Notification for Recipient
    BEGIN
        INSERT INTO public.notifications (
            user_id, type, title, message, metadata, is_read, created_at
        )
        VALUES (
            v_recipient_id,
            'internal_transfer_received',
            'Funds Received',
            'You received ' || v_net_amount::TEXT || ' ' || v_asset_clean || ' from @' || (SELECT username FROM public.profiles WHERE id = p_sender_id),
            jsonb_build_object(
                'sender_id', p_sender_id,
                'amount', v_net_amount,
                'asset', v_asset_clean,
                'transfer_id', v_transfer_id
            ),
            false,
            NOW()
        );
    EXCEPTION WHEN undefined_table THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'gross_amount', p_gross_amount,
        'net_amount', v_net_amount,
        'fee_amount', v_fee_amount,
        'asset', v_asset_clean,
        'recipient_username', p_recipient_username
    );
END;
$$;
