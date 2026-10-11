-- Enforce individual emergency freezes inside the canonical transfer RPC,
-- not only in the API route. This protects every trusted server caller.
BEGIN;

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
SET search_path = ''
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
    v_sender_emergency_frozen BOOLEAN := FALSE;
    v_recipient_emergency_frozen BOOLEAN := FALSE;
    
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

    -- 2. Sender Profile & ACTIVE Status Validation
    SELECT 
        username,
        COALESCE(is_banned, FALSE),
        COALESCE(is_restricted, FALSE),
        COALESCE(is_emergency_frozen, FALSE),
        LOWER(COALESCE(account_status, 'active'))
    INTO 
        v_sender_name,
        v_sender_banned,
        v_sender_restricted,
        v_sender_emergency_frozen,
        v_sender_status
    FROM public.profiles
    WHERE id = p_sender_id;

    IF v_sender_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile not found');
    END IF;

    IF v_sender_banned OR v_sender_restricted OR v_sender_emergency_frozen OR v_sender_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account is restricted or non-active. Transfers are blocked.');
    END IF;

    -- 3. Recipient Resolution & ACTIVE Status Validation
    SELECT 
        id,
        username,
        COALESCE(is_banned, FALSE),
        COALESCE(is_restricted, FALSE),
        COALESCE(is_emergency_frozen, FALSE),
        LOWER(COALESCE(account_status, 'active'))
    INTO 
        v_recipient_id,
        v_recipient_name,
        v_recipient_banned,
        v_recipient_restricted,
        v_recipient_emergency_frozen,
        v_recipient_status
    FROM public.profiles
    WHERE LOWER(username) = v_clean_username
       OR LOWER(email) = v_clean_username
       OR id::TEXT = v_clean_username
    LIMIT 1;

    -- Fallback: Check deposit addresses for recipient user resolution
    IF v_recipient_id IS NULL THEN
        SELECT uda.user_id, p.username, COALESCE(p.is_banned, FALSE), COALESCE(p.is_restricted, FALSE), COALESCE(p.is_emergency_frozen, FALSE), LOWER(COALESCE(p.account_status, 'active'))
        INTO v_recipient_id, v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_emergency_frozen, v_recipient_status
        FROM public.user_deposit_addresses uda
        JOIN public.profiles p ON p.id = uda.user_id
        WHERE uda.address = p_recipient_username
        LIMIT 1;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient user @' || p_recipient_username || ' not found on the platform');
    END IF;

    IF v_recipient_id = p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot transfer funds to yourself');
    END IF;

    IF v_recipient_banned OR v_recipient_restricted OR v_recipient_emergency_frozen OR v_recipient_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot transfer: Recipient account is restricted or non-active on the platform.');
    END IF;

    -- 4. Full Multi-Parameter Idempotency Validation with Advisory Lock
    -- Must validate sender_id, recipient_id, asset, and amount
    IF v_clean_idempotency IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('trf:' || p_sender_id::TEXT || ':' || v_clean_idempotency));

        -- Check existing transfer for this sender and idempotency key
        SELECT * INTO v_existing_transfer
        FROM public.transfers
        WHERE sender_id = p_sender_id AND idempotency_key = v_clean_idempotency
        LIMIT 1;

        IF v_existing_transfer.id IS NOT NULL THEN
            -- Strict validation across ALL transfer parameters
            IF v_existing_transfer.recipient_id <> v_recipient_id
               OR UPPER(COALESCE(v_existing_transfer.crypto, v_existing_transfer.asset_symbol, '')) <> v_asset_clean
               OR v_existing_transfer.amount <> p_gross_amount THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Idempotency conflict: A transfer with this idempotency key was already submitted with different parameters (recipient, asset, or amount)'
                );
            END IF;

            -- Identical replay confirmed: Return existing transfer without financial mutation
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
    -- Entered amount is the Recipient Amount R.
    v_recipient_amount := p_gross_amount;
    v_fee_amount := ROUND((v_recipient_amount * v_fee_rate)::numeric, 8);
    v_total_deduction := v_recipient_amount + v_fee_amount;

    -- 6. Ensure Recipient wallet_assets record exists (strictly using live columns)
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

    -- 7. Deterministic Deadlock-Safe Row Locking
    -- Acquire locks on wallet_assets rows in consistent UUID order (smaller UUID first)
    IF p_sender_id < v_recipient_id THEN
        -- Lock Sender first
        SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
        FROM public.wallet_assets
        WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        -- Lock Recipient second
        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;
    ELSE
        -- Lock Recipient first
        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        -- Lock Sender second
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
    -- Authoritative spendable balance is wallet_assets.balance
    IF v_sender_bal IS NULL OR v_sender_bal < v_total_deduction THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient spendable ' || v_asset_clean || ' balance. Required: ' || v_total_deduction::TEXT || ' ' || v_asset_clean || ' (Recipient Amount: ' || v_recipient_amount::TEXT || ' + 1.5% Fee: ' || v_fee_amount::TEXT || '), Available: ' || COALESCE(v_sender_bal, 0)::TEXT || ' ' || v_asset_clean
        );
    END IF;

    -- 9. Atomic Financial Balance Mutations on wallet_assets
    -- Debit Sender: balance - (R + F)
    v_sender_bal_after := v_sender_bal - v_total_deduction;
    UPDATE public.wallet_assets
    SET balance = v_sender_bal_after,
        updated_at = NOW()
    WHERE id = v_sender_wallet_asset_id;

    -- Credit Recipient: balance + R
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
    -- Sender Entry: type = 'transfer', amount = -(R + F)
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

    -- Recipient Entry: type = 'transfer', amount = +R
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
        -- Non-blocking notification fail-safe
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

-- ----------------------------------------------------------------------------
-- 4. Permissions Hardening
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

COMMIT;
