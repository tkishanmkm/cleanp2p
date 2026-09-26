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
    -- Normalized input variables
    v_norm_address TEXT;
    v_norm_asset TEXT;
    v_norm_network TEXT;
    v_norm_tx_hash TEXT;
    v_norm_output_index INTEGER;
    v_norm_contract TEXT;

    -- Ownership & Resolution
    v_user_id UUID;

    -- Rules & thresholds
    v_required_confirmations INTEGER;
    v_is_confirmed BOOLEAN;

    -- State tracking flags and IDs
    v_existing_onchain_status TEXT;
    v_existing_deposit_id UUID;
    v_onchain_network TEXT;

    -- Balance tracking variables (Live Schema: wallet_assets.balance)
    v_current_balance NUMERIC(36, 18);
    v_new_balance NUMERIC(36, 18);
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

    -- Onchain persistence network normalization (ETH/ETHEREUM -> ERC20 for onchain_deposits constraint)
    v_onchain_network := CASE 
        WHEN v_norm_network IN ('ETH', 'ETHEREUM') THEN 'ERC20'
        ELSE v_norm_network
    END;

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
    ELSIF v_norm_network = 'LTC' AND v_norm_asset = 'LTC' THEN
        IF v_norm_contract <> '' THEN
            RETURN jsonb_build_object('success', false, 'code', 'TOKEN_CONTRACT_NOT_ALLOWED', 'message', 'Token contract must be empty for native LTC');
        END IF;
        v_required_confirmations := 6;
    ELSIF v_norm_network = 'ETH' AND v_norm_asset = 'ETH' THEN
        IF v_norm_contract <> '' THEN
            RETURN jsonb_build_object('success', false, 'code', 'TOKEN_CONTRACT_NOT_ALLOWED', 'message', 'Token contract must be empty for native ETH');
        END IF;
        v_required_confirmations := 12;
    ELSIF v_norm_network = 'ERC20' AND v_norm_asset = 'USDT' THEN
        IF LOWER(v_norm_contract) NOT IN (
            '0xdac17f958d2ee523a2206206994597c13d831ec7', -- Mainnet USDT
            '0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0'  -- Sepolia Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for ERC20 USDT');
        END IF;
        v_required_confirmations := 12;
    ELSIF v_norm_network = 'BEP20' AND v_norm_asset = 'USDT' THEN
        IF LOWER(v_norm_contract) NOT IN (
            '0x55d398326f99059ff775485246999027b3197955', -- BSC Mainnet USDT
            '0x337610d27c682e347c9cd60bd4b3b107c9d34ddd'  -- BSC Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for BEP20 USDT');
        END IF;
        v_required_confirmations := 15;
    ELSIF v_norm_network = 'TRC20' AND v_norm_asset = 'USDT' THEN
        IF v_norm_contract NOT IN (
            'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', -- TRON Mainnet USDT
            'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', -- TRON Nile Testnet USDT (Canonical)
            'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj', -- TRON Nile Testnet USDT (Legacy)
            'TG3XXyExBkPp9nzdajDZsozEu43n6nVns5'  -- TRON Shasta Testnet USDT
        ) THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_TOKEN_CONTRACT', 'message', 'Invalid token contract for TRC20 USDT');
        END IF;
        v_required_confirmations := 19;
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
    SELECT user_id
    INTO v_user_id
    FROM public.user_deposit_addresses
    WHERE (
        CASE
            WHEN UPPER(BTRIM(network::text))
                 IN ('ETH', 'ERC20', 'BEP20', 'ETHEREUM')
            THEN LOWER(BTRIM(address))
            ELSE BTRIM(address)
        END
    ) = v_norm_address
    AND (
        CASE
            WHEN UPPER(BTRIM(network::text)) = 'ETHEREUM'
            THEN 'ETH'
            ELSE UPPER(BTRIM(network::text))
        END
    ) = v_norm_network
    LIMIT 1;

    IF NOT FOUND OR v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false, 
            'code', 'DEPOSIT_ADDRESS_NOT_FOUND', 
            'message', 'Destination address is not registered to any user for this network'
        );
    END IF;

    -- 5. Existing State Verification & Idempotency Check
    SELECT status INTO v_existing_onchain_status
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_norm_tx_hash 
      AND UPPER(BTRIM(network)) = v_onchain_network 
      AND output_index = v_norm_output_index
    FOR UPDATE;

    IF FOUND AND v_existing_onchain_status = 'CONFIRMED' THEN
        RETURN jsonb_build_object(
            'success', true, 
            'already_credited', true, 
            'code', 'ALREADY_PROCESSED', 
            'message', 'Deposit has already been credited'
        );
    END IF;

    -- Look up existing core deposit ID
    SELECT id INTO v_existing_deposit_id
    FROM public.deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_norm_tx_hash
      AND UPPER(BTRIM(chain)) = v_norm_network
      AND output_index = v_norm_output_index
    FOR UPDATE;

    -- 6. Branch A: Deposit Unconfirmed / Pending State Recording
    IF NOT v_is_confirmed THEN
        -- Upsert into onchain_deposits using matching functional unique index
        INSERT INTO public.onchain_deposits (
            user_id, tx_hash, network, address, to_address, amount, asset_symbol,
            confirmations, required_confirmations, status, output_index, created_at, updated_at
        ) VALUES (
            v_user_id, v_norm_tx_hash, v_onchain_network, v_norm_address, v_norm_address, p_amount, v_norm_asset,
            COALESCE(p_confirmations, 0), v_required_confirmations, 'PENDING', v_norm_output_index, NOW(), NOW()
        )
        ON CONFLICT (LOWER(BTRIM(tx_hash)), UPPER(BTRIM(network)), output_index)
        DO UPDATE SET
            confirmations = EXCLUDED.confirmations,
            updated_at = NOW()
        WHERE public.onchain_deposits.status = 'PENDING';

        -- Update or Insert into deposits
        IF v_existing_deposit_id IS NOT NULL THEN
            UPDATE public.deposits
            SET status = 'pending'
            WHERE id = v_existing_deposit_id;
        ELSE
            INSERT INTO public.deposits (
                user_id, chain, token_symbol, asset, tx_hash, output_index, amount,
                from_address, to_address, status, block_number, created_at
            ) VALUES (
                v_user_id, v_norm_network, v_norm_asset, v_norm_asset, v_norm_tx_hash, v_norm_output_index, p_amount,
                p_from_address, v_norm_address, 'pending', p_block_number, NOW()
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true, 
            'credited', false, 
            'code', 'DEPOSIT_PENDING_CONFIRMATION', 
            'confirmations', COALESCE(p_confirmations, 0), 
            'required_confirmations', v_required_confirmations
        );
    END IF;

    -- 7. Branch B: Confirmed Deposit Processing & Financial Crediting
    -- Concurrency-safe first-row initialization for wallet_assets (user_id, asset_symbol)
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
        v_user_id,
        v_norm_asset,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol)
    DO NOTHING;

    -- Lock row for update
    SELECT balance
    INTO v_current_balance
    FROM public.wallet_assets
    WHERE user_id = v_user_id AND asset_symbol = v_norm_asset
    FOR UPDATE;

    v_new_balance := COALESCE(v_current_balance, 0.0) + p_amount;

    -- Mutate wallet_assets balance on Live Schema
    UPDATE public.wallet_assets
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE user_id = v_user_id AND asset_symbol = v_norm_asset;

    -- Write Immutable Wallet Financial Ledger Entry on Live Schema
    INSERT INTO public.ledger_entries (
        user_id, crypto, asset, chain, amount, type, status,
        reference_id, balance_after, metadata, created_at
    ) VALUES (
        v_user_id, v_norm_asset, v_norm_asset, v_norm_network, p_amount, 'deposit', 'completed',
        v_norm_tx_hash, v_new_balance,
        jsonb_build_object(
            'provider', p_provider,
            'token_contract', p_token_contract,
            'block_number', p_block_number,
            'from_address', p_from_address,
            'destination_address', v_norm_address,
            'output_index', v_norm_output_index,
            'required_confirmations', v_required_confirmations,
            'confirmations', COALESCE(p_confirmations, v_required_confirmations)
        ),
        NOW()
    );

    -- Update or Insert into deposits on Live Schema (Status: 'confirmed')
    IF v_existing_deposit_id IS NOT NULL THEN
        UPDATE public.deposits
        SET status = 'confirmed',
            block_number = COALESCE(p_block_number, public.deposits.block_number)
        WHERE id = v_existing_deposit_id;
    ELSE
        INSERT INTO public.deposits (
            user_id, chain, token_symbol, asset, tx_hash, output_index, amount,
            from_address, to_address, status, block_number, created_at
        ) VALUES (
            v_user_id, v_norm_network, v_norm_asset, v_norm_asset, v_norm_tx_hash, v_norm_output_index, p_amount,
            p_from_address, v_norm_address, 'confirmed', p_block_number, NOW()
        );
    END IF;

    -- Upsert / Update onchain_deposits record as CONFIRMED on Live Schema
    INSERT INTO public.onchain_deposits (
        user_id, tx_hash, network, address, to_address, amount, asset_symbol,
        confirmations, required_confirmations, status, output_index, created_at, updated_at
    ) VALUES (
        v_user_id, v_norm_tx_hash, v_onchain_network, v_norm_address, v_norm_address, p_amount, v_norm_asset,
        COALESCE(p_confirmations, v_required_confirmations), v_required_confirmations, 'CONFIRMED', v_norm_output_index, NOW(), NOW()
    )
    ON CONFLICT (LOWER(BTRIM(tx_hash)), UPPER(BTRIM(network)), output_index)
    DO UPDATE SET
        confirmations = EXCLUDED.confirmations,
        status = 'CONFIRMED',
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true, 
        'credited', true, 
        'code', 'DEPOSIT_CREDITED', 
        'user_id', v_user_id, 
        'amount', p_amount, 
        'asset_symbol', v_norm_asset, 
        'new_balance', v_new_balance
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_deposit_atomic FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_deposit_atomic TO service_role, postgres;
