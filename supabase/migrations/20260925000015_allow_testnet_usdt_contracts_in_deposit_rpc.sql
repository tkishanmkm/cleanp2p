-- ==============================================================================
-- 20260925000015_allow_testnet_usdt_contracts_in_deposit_rpc.sql
-- 
-- SUMMARY:
-- Updates public.process_deposit_atomic() to validate canonical testnet USDT contracts
-- alongside production Mainnet USDT contracts for TRC20, ERC20, and BEP20.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.process_deposit_atomic(
    p_destination_address TEXT,
    p_asset_symbol TEXT,
    p_network_code TEXT,
    p_amount NUMERIC,
    p_tx_hash TEXT,
    p_output_index INTEGER DEFAULT 0,
    p_block_number BIGINT DEFAULT NULL,
    p_from_address TEXT DEFAULT NULL,
    p_token_contract TEXT DEFAULT NULL,
    p_confirmations INTEGER DEFAULT 0,
    p_provider TEXT DEFAULT 'internal'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Normalized variables
    v_norm_address TEXT;
    v_norm_asset TEXT;
    v_norm_network TEXT;
    v_norm_tx_hash TEXT;
    v_norm_output_index INTEGER;
    v_norm_contract TEXT;

    -- Ownership variables
    v_user_id UUID;
    v_wallet_id UUID;
    v_asset_code TEXT;
    v_wallet_status TEXT;

    -- Rules & thresholds
    v_required_confirmations INTEGER;
    v_is_confirmed BOOLEAN;

    -- Identity & Idempotency
    v_dep_idempotency_key TEXT;
    v_ledger_idempotency_key TEXT;

    -- State tracking flags and records
    v_onchain_exists BOOLEAN;
    v_deposit_exists BOOLEAN;
    v_ledger_exists BOOLEAN;

    v_existing_onchain RECORD;
    v_existing_deposit RECORD;
    v_existing_ledger RECORD;
    v_deposit_id UUID;

    -- Balance variables
    v_current_available NUMERIC(36, 18);
    v_current_locked_escrow NUMERIC(36, 18);
    v_current_locked_withdrawal NUMERIC(36, 18);
    v_new_available NUMERIC(36, 18);
BEGIN
    -- 1. Input Sanitization & Base Validations
    IF p_destination_address IS NULL OR BTRIM(p_destination_address) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_DESTINATION_ADDRESS', 'message', 'Destination address is required');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_DEPOSIT_AMOUNT', 'message', 'Deposit amount must be greater than zero');
    END IF;

    IF p_tx_hash IS NULL OR BTRIM(p_tx_hash) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TX_HASH', 'message', 'Transaction hash is required');
    END IF;

    IF p_output_index IS NULL OR p_output_index < 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_OUTPUT_INDEX', 'message', 'Output index must be non-negative');
    END IF;

    IF p_network_code IS NULL OR BTRIM(p_network_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_NETWORK_CODE', 'message', 'Network code is required');
    END IF;

    IF p_asset_symbol IS NULL OR BTRIM(p_asset_symbol) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_ASSET_SYMBOL', 'message', 'Asset symbol is required');
    END IF;

    v_norm_network := UPPER(BTRIM(p_network_code));
    v_norm_asset := UPPER(BTRIM(p_asset_symbol));
    v_norm_tx_hash := LOWER(BTRIM(p_tx_hash));
    v_norm_output_index := p_output_index;
    v_norm_contract := BTRIM(COALESCE(p_token_contract, ''));

    -- Normalized address strictly matching canonical functional index
    v_norm_address := CASE 
        WHEN v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN LOWER(BTRIM(p_destination_address))
        ELSE BTRIM(p_destination_address)
    END;

    -- 2. Network / Asset / Token Contract Matrix Validation & Confirmation Assignment
    IF v_norm_network = 'BTC' AND v_norm_asset = 'BTC' THEN
        IF v_norm_contract <> '' THEN
            RETURN jsonb_build_object('success', false, 'code', 'TOKEN_CONTRACT_NOT_ALLOWED', 'message', 'Token contract must be empty for native BTC');
        END IF;
        v_required_confirmations := 1;
        v_asset_code := 'BTC';
    ELSIF v_norm_network = 'LTC' AND v_norm_asset = 'LTC' THEN
        IF v_norm_contract <> '' THEN
            RETURN jsonb_build_object('success', false, 'code', 'TOKEN_CONTRACT_NOT_ALLOWED', 'message', 'Token contract must be empty for native LTC');
        END IF;
        v_required_confirmations := 6;
        v_asset_code := 'LTC';
    ELSIF v_norm_network = 'ETH' AND v_norm_asset = 'ETH' THEN
        IF v_norm_contract <> '' THEN
            RETURN jsonb_build_object('success', false, 'code', 'TOKEN_CONTRACT_NOT_ALLOWED', 'message', 'Token contract must be empty for native ETH');
        END IF;
        v_required_confirmations := 12;
        v_asset_code := 'ETH';
    ELSIF v_norm_network = 'ERC20' AND v_norm_asset = 'USDT' THEN
        IF LOWER(v_norm_contract) NOT IN (
            '0xdac17f958d2ee523a2206206994597c13d831ec7', -- Mainnet USDT
            '0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0'  -- Sepolia Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for ERC20 USDT');
        END IF;
        v_required_confirmations := 12;
        v_asset_code := 'USDT';
    ELSIF v_norm_network = 'BEP20' AND v_norm_asset = 'USDT' THEN
        IF LOWER(v_norm_contract) NOT IN (
            '0x55d398326f99059ff775485246999027b3197955', -- BSC Mainnet USDT
            '0x337610d27c682e347c9cd60bd4b3b107c9d34ddd'  -- BSC Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for BEP20 USDT');
        END IF;
        v_required_confirmations := 15;
        v_asset_code := 'USDT';
    ELSIF v_norm_network = 'TRC20' AND v_norm_asset = 'USDT' THEN
        IF v_norm_contract NOT IN (
            'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', -- TRON Mainnet USDT
            'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', -- TRON Nile Testnet USDT
            'TG3XXyExBkPp9nzdajDZsozEu43n6nVns5'  -- TRON Shasta Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for TRC20 USDT');
        END IF;
        v_required_confirmations := 19;
        v_asset_code := 'USDT';
    ELSE
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'INVALID_NETWORK_ASSET', 
            'message', format('Unsupported network %s and asset %s combination', v_norm_network, v_norm_asset)
        );
    END IF;

    v_is_confirmed := (COALESCE(p_confirmations, 0) >= v_required_confirmations);

    -- 3. Transaction-Scoped Advisory Lock on Canonical Deposit Identity
    PERFORM pg_advisory_xact_lock(
        hashtext('deposit_' || v_norm_network || '_' || v_norm_tx_hash || '_' || v_norm_output_index::text)
    );

    -- 4. Address Ownership Resolution from Authoritative user_deposit_addresses
    SELECT user_id, wallet_id
    INTO v_user_id, v_wallet_id
    FROM public.user_deposit_addresses
    WHERE (
        CASE 
            WHEN UPPER(BTRIM(network)) IN ('ETH', 'ERC20', 'BEP20') THEN LOWER(BTRIM(address))
            ELSE BTRIM(address)
        END
    ) = v_norm_address
      AND UPPER(BTRIM(network)) = v_norm_network
    LIMIT 1;

    IF NOT FOUND OR v_user_id IS NULL OR v_wallet_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'DEPOSIT_ADDRESS_NOT_FOUND', 
            'message', 'Destination address is not registered to any user for this network'
        );
    END IF;

    -- Verify wallet belongs to resolved user and is ACTIVE
    SELECT status INTO v_wallet_status
    FROM public.wallets 
    WHERE id = v_wallet_id AND user_id = v_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'WALLET_USER_MISMATCH', 
            'message', 'Resolved wallet does not belong to resolved user'
        );
    END IF;

    IF v_wallet_status <> 'active' THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'WALLET_NOT_ACTIVE', 
            'message', format('Wallet is in %s status and cannot accept deposits', COALESCE(v_wallet_status, 'unknown'))
        );
    END IF;

    -- Construct Canonical Idempotency Keys
    v_dep_idempotency_key := 'dep_' || v_norm_network || '_' || v_norm_tx_hash || '_' || v_norm_output_index::text;
    v_ledger_idempotency_key := 'ledger_dep_' || v_norm_network || '_' || v_norm_tx_hash || '_' || v_norm_output_index::text;

    -- 5. Existing State Verification & Cross-Table Inconsistency Checks
    SELECT * INTO v_existing_onchain
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_norm_tx_hash 
      AND UPPER(BTRIM(network)) = v_norm_network 
      AND output_index = v_norm_output_index
    FOR UPDATE;
    v_onchain_exists := FOUND;

    SELECT * INTO v_existing_deposit
    FROM public.deposits
    WHERE idempotency_key = v_dep_idempotency_key
    FOR UPDATE;
    v_deposit_exists := FOUND;

    SELECT * INTO v_existing_ledger
    FROM public.ledger_entries
    WHERE idempotency_key = v_ledger_idempotency_key;
    v_ledger_exists := FOUND;

    -- Fail Closed on One-Sided or Inconsistent Tracking States
    IF v_onchain_exists AND NOT v_deposit_exists THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Onchain record exists but core deposits record is missing');
    END IF;

    IF NOT v_onchain_exists AND v_deposit_exists THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Core deposits record exists but onchain record is missing');
    END IF;

    IF NOT v_onchain_exists AND NOT v_deposit_exists AND v_ledger_exists THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Orphaned ledger entry exists without state records');
    END IF;

    -- When both state records exist, validate immutable identity attributes
    IF v_onchain_exists AND v_deposit_exists THEN
        IF v_existing_onchain.user_id IS DISTINCT FROM v_user_id
           OR UPPER(BTRIM(v_existing_onchain.asset_symbol)) IS DISTINCT FROM v_norm_asset
           OR v_existing_onchain.amount IS DISTINCT FROM p_amount 
        THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_IDENTITY_CONFLICT', 'message', 'Conflicting identity attributes on existing onchain record');
        END IF;

        IF v_existing_deposit.user_id IS DISTINCT FROM v_user_id
           OR v_existing_deposit.wallet_id IS DISTINCT FROM v_wallet_id
           OR UPPER(BTRIM(v_existing_deposit.asset_code)) IS DISTINCT FROM v_asset_code
           OR UPPER(BTRIM(v_existing_deposit.network_code)) IS DISTINCT FROM v_norm_network
           OR LOWER(BTRIM(v_existing_deposit.txid)) IS DISTINCT FROM v_norm_tx_hash
           OR v_existing_deposit.output_index IS DISTINCT FROM v_norm_output_index
           OR v_existing_deposit.amount IS DISTINCT FROM p_amount
        THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_IDENTITY_CONFLICT', 'message', 'Conflicting identity attributes on existing deposits record');
        END IF;

        -- Validate Status Synchronization across onchain_deposits and deposits
        IF v_existing_onchain.status = 'CREDITED' AND v_existing_deposit.status <> 'credited' THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Onchain status is CREDITED but core deposits status is not credited');
        END IF;

        IF v_existing_deposit.status = 'credited' AND v_existing_onchain.status <> 'CREDITED' THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Core deposits status is credited but onchain status is not CREDITED');
        END IF;

        -- Valid Already Credited Deposit (Rigorous Ledger Audit)
        IF v_existing_onchain.status = 'CREDITED' AND v_existing_deposit.status = 'credited' THEN
            IF NOT v_ledger_exists THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Deposit marked credited but missing ledger entry');
            END IF;

            -- Rigorous validation of all immutable financial ledger invariants
            IF v_existing_ledger.wallet_id IS DISTINCT FROM v_wallet_id
               OR v_existing_ledger.user_id IS DISTINCT FROM v_user_id
               OR v_existing_ledger.asset_code IS DISTINCT FROM v_asset_code
               OR v_existing_ledger.entry_type IS DISTINCT FROM 'deposit_credit'
               OR v_existing_ledger.ref_table IS DISTINCT FROM 'deposits'
               OR v_existing_ledger.ref_id IS DISTINCT FROM v_existing_deposit.id::text
               OR v_existing_ledger.idempotency_key IS DISTINCT FROM v_ledger_idempotency_key
               OR v_existing_ledger.delta_available IS DISTINCT FROM p_amount
               OR v_existing_ledger.delta_locked IS DISTINCT FROM 0
               OR v_existing_ledger.available_after IS NULL
               OR v_existing_ledger.available_after < p_amount
               OR v_existing_ledger.locked_after IS NULL
               OR v_existing_ledger.locked_after < 0
            THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Existing ledger entry violates canonical financial invariants');
            END IF;

            RETURN jsonb_build_object(
                'success', true, 
                'already_credited', true, 
                'code', 'ALREADY_PROCESSED', 
                'message', 'Deposit has already been credited'
            );
        END IF;

        -- Pending status cannot have an existing ledger entry
        IF (v_existing_onchain.status = 'PENDING' OR v_existing_deposit.status = 'pending') AND v_ledger_exists THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Pending deposit has unexpected ledger entry');
        END IF;
    END IF;

    -- 6. Branch A: Deposit Unconfirmed / Pending State Recording
    IF NOT v_is_confirmed THEN
        -- Upsert into onchain_deposits
        INSERT INTO public.onchain_deposits (
            user_id, tx_hash, network, to_address, from_address, amount, asset_symbol,
            confirmations, required_confirmations, status, block_number, metadata, output_index, created_at, updated_at
        ) VALUES (
            v_user_id, v_norm_tx_hash, v_norm_network, v_norm_address, p_from_address, p_amount, v_norm_asset,
            COALESCE(p_confirmations, 0), v_required_confirmations, 'PENDING', p_block_number,
            jsonb_build_object('provider', p_provider, 'token_contract', p_token_contract), v_norm_output_index, NOW(), NOW()
        )
        ON CONFLICT (LOWER(BTRIM(tx_hash)), UPPER(BTRIM(network)), output_index)
        DO UPDATE SET
            confirmations = EXCLUDED.confirmations,
            block_number = COALESCE(EXCLUDED.block_number, public.onchain_deposits.block_number),
            updated_at = NOW()
        WHERE public.onchain_deposits.status = 'PENDING';

        -- Upsert into deposits
        INSERT INTO public.deposits (
            user_id, wallet_id, asset_code, network_code, amount, txid, output_index,
            confirmations, status, idempotency_key, created_at, updated_at
        ) VALUES (
            v_user_id, v_wallet_id, v_asset_code, v_norm_network, p_amount, v_norm_tx_hash, v_norm_output_index,
            COALESCE(p_confirmations, 0), 'pending', v_dep_idempotency_key, NOW(), NOW()
        )
        ON CONFLICT (idempotency_key)
        DO UPDATE SET
            confirmations = EXCLUDED.confirmations,
            updated_at = NOW()
        WHERE public.deposits.status = 'pending';

        RETURN jsonb_build_object(
            'success', true, 
            'credited', false, 
            'code', 'DEPOSIT_PENDING_CONFIRMATION', 
            'confirmations', COALESCE(p_confirmations, 0), 
            'required_confirmations', v_required_confirmations
        );
    END IF;

    -- 7. Branch B: Confirmed Deposit Processing & Financial Crediting
    -- Lock and verify wallet_assets provisioning (auto-init zero baseline if missing)
    SELECT available, locked_escrow, locked_withdrawal
    INTO v_current_available, v_current_locked_escrow, v_current_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code
    FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.wallet_assets (
            wallet_id,
            asset_code,
            available,
            locked_escrow,
            locked_withdrawal
        )
        VALUES (
            v_wallet_id,
            v_asset_code,
            0.0,
            0.0,
            0.0
        );

        v_current_available := 0.0;
        v_current_locked_escrow := 0.0;
        v_current_locked_withdrawal := 0.0;
    END IF;

    v_new_available := v_current_available + p_amount;

    -- Resolve/Insert deposits record and obtain deposits.id
    IF v_deposit_exists THEN
        v_deposit_id := v_existing_deposit.id;
        UPDATE public.deposits
        SET confirmations = COALESCE(p_confirmations, v_required_confirmations),
            status = 'credited',
            credited_at = COALESCE(public.deposits.credited_at, NOW()),
            updated_at = NOW()
        WHERE id = v_deposit_id;
    ELSE
        INSERT INTO public.deposits (
            user_id, wallet_id, asset_code, network_code, amount, txid, output_index,
            confirmations, status, credited_at, idempotency_key, created_at, updated_at
        ) VALUES (
            v_user_id, v_wallet_id, v_asset_code, v_norm_network, p_amount, v_norm_tx_hash, v_norm_output_index,
            COALESCE(p_confirmations, v_required_confirmations), 'credited', NOW(), v_dep_idempotency_key, NOW(), NOW()
        )
        RETURNING id INTO v_deposit_id;
    END IF;

    -- Mutate wallet_assets available balance
    UPDATE public.wallet_assets
    SET available = v_new_available,
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code;

    -- Write Immutable Wallet Financial Ledger Entry referencing deposits.id::text
    INSERT INTO public.ledger_entries (
        wallet_id, user_id, asset_code, delta_available, delta_locked,
        available_after, locked_after, entry_type, ref_table, ref_id, idempotency_key, created_at
    ) VALUES (
        v_wallet_id, v_user_id, v_asset_code, p_amount, 0.0,
        v_new_available, (v_current_locked_escrow + v_current_locked_withdrawal),
        'deposit_credit', 'deposits', v_deposit_id::text, v_ledger_idempotency_key, NOW()
    );

    -- Upsert / Update onchain_deposits record as CREDITED
    INSERT INTO public.onchain_deposits (
        user_id, tx_hash, network, to_address, from_address, amount, asset_symbol,
        confirmations, required_confirmations, status, block_number, metadata, credited_at, output_index, created_at, updated_at
    ) VALUES (
        v_user_id, v_norm_tx_hash, v_norm_network, v_norm_address, p_from_address, p_amount, v_norm_asset,
        COALESCE(p_confirmations, v_required_confirmations), v_required_confirmations, 'CREDITED', p_block_number,
        jsonb_build_object('provider', p_provider, 'token_contract', p_token_contract), NOW(), v_norm_output_index, NOW(), NOW()
    )
    ON CONFLICT (LOWER(BTRIM(tx_hash)), UPPER(BTRIM(network)), output_index)
    DO UPDATE SET
        confirmations = EXCLUDED.confirmations,
        status = 'CREDITED',
        credited_at = COALESCE(public.onchain_deposits.credited_at, NOW()),
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true, 
        'credited', true, 
        'code', 'DEPOSIT_CREDITED', 
        'user_id', v_user_id, 
        'amount', p_amount, 
        'asset_code', v_asset_code, 
        'new_available_balance', v_new_available
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_deposit_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_deposit_atomic TO service_role, postgres;

COMMIT;
