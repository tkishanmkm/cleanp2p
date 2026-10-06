-- ============================================================================
-- MIGRATION: 20261001000000_canonical_process_deposit_atomic_part6k7.sql
-- TARGET: public.process_deposit_atomic
-- MODE: CANONICAL PRODUCTION ATOMIC DEPOSIT PROCESSING FUNCTION (PART 6K.7)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.process_deposit_atomic(
    p_destination_address text,
    p_asset_symbol text,
    p_network_code text,
    p_amount numeric,
    p_tx_hash text,
    p_output_index integer DEFAULT 0,
    p_block_number bigint DEFAULT NULL,
    p_from_address text DEFAULT NULL,
    p_token_contract text DEFAULT NULL,
    p_confirmations integer DEFAULT 0,
    p_provider text DEFAULT 'internal'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    -- Normalized input representations
    v_norm_network text;
    v_norm_asset text;
    v_norm_contract text;
    v_canonical_address text;
    v_canonical_tx_hash text;
    v_canonical_from text;

    -- Network configuration & thresholds
    v_expected_contract text;
    v_expected_asset text;
    v_required_confirmations integer;
    v_effective_confirmations integer;
    v_is_confirmed boolean;
    v_effective_block_number bigint;

    -- Routing & Wallet records
    v_user_id uuid;
    v_wallet_id uuid;
    v_wallet_status text;
    v_asset_id uuid;
    v_prev_balance numeric;
    v_new_balance numeric;

    -- Existing records
    v_existing_deposit record;
    v_existing_onchain record;

    -- Ledger verification
    v_existing_ledger record;
    v_ledger_count integer;
    v_deposit_id uuid;
    v_onchain_id uuid;
    v_ledger_id uuid;

    -- Existing address comparison
    v_existing_onchain_addr text;
    v_existing_onchain_to_addr text;
    v_existing_deposit_to_addr text;
BEGIN
    -- ------------------------------------------------------------------------
    -- 1. INPUT SANITIZATION & STRICT FORMAT VALIDATION
    -- ------------------------------------------------------------------------
    IF p_tx_hash IS NULL OR BTRIM(p_tx_hash) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TX_HASH', 'message', 'Transaction hash is required');
    END IF;

    IF p_destination_address IS NULL OR BTRIM(p_destination_address) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_ADDRESS', 'message', 'Destination address is required');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT', 'message', 'Deposit amount must be strictly greater than zero');
    END IF;

    IF p_network_code IS NULL OR BTRIM(p_network_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_NETWORK', 'message', 'Network code is required');
    END IF;

    IF p_asset_symbol IS NULL OR BTRIM(p_asset_symbol) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_ASSET', 'message', 'Asset symbol is required');
    END IF;

    IF p_output_index IS NULL OR p_output_index < 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_OUTPUT_INDEX', 'message', 'Output index must be a non-negative integer');
    END IF;

    IF p_confirmations IS NOT NULL AND p_confirmations < 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_CONFIRMATIONS', 'message', 'Confirmations cannot be negative');
    END IF;

    IF p_block_number IS NOT NULL AND p_block_number < 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_BLOCK_NUMBER', 'message', 'Block number cannot be negative');
    END IF;

    v_norm_network := UPPER(BTRIM(p_network_code));
    v_norm_asset   := UPPER(BTRIM(p_asset_symbol));

    -- ------------------------------------------------------------------------
    -- 2. CANONICAL NORMALIZATION & NETWORK MATRIX VALIDATION
    -- ------------------------------------------------------------------------
    IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
        v_canonical_tx_hash := LOWER(BTRIM(p_tx_hash));
        v_canonical_address := LOWER(BTRIM(p_destination_address));
        v_norm_contract     := CASE WHEN p_token_contract IS NOT NULL AND BTRIM(p_token_contract) <> '' 
                                    THEN LOWER(BTRIM(p_token_contract)) ELSE NULL END;
        v_canonical_from    := CASE WHEN p_from_address IS NOT NULL AND BTRIM(p_from_address) <> '' 
                                    THEN LOWER(BTRIM(p_from_address)) ELSE NULL END;
    ELSIF v_norm_network IN ('BTC', 'LTC', 'TRC20') THEN
        v_canonical_tx_hash := BTRIM(p_tx_hash);
        v_canonical_address := BTRIM(p_destination_address);
        v_norm_contract     := CASE WHEN p_token_contract IS NOT NULL AND BTRIM(p_token_contract) <> '' 
                                    THEN BTRIM(p_token_contract) ELSE NULL END;
        v_canonical_from    := CASE WHEN p_from_address IS NOT NULL AND BTRIM(p_from_address) <> '' 
                                    THEN BTRIM(p_from_address) ELSE NULL END;
    ELSE
        RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_NETWORK', 'message', 'Network ' || v_norm_network || ' is not supported');
    END IF;

    -- Strict Production Network / Asset / Contract / Required Confirmations Matrix
    CASE v_norm_network
        WHEN 'BTC' THEN
            v_expected_asset := 'BTC';
            v_expected_contract := NULL;
            v_required_confirmations := 3;

        WHEN 'LTC' THEN
            v_expected_asset := 'LTC';
            v_expected_contract := NULL;
            v_required_confirmations := 12;

        WHEN 'ETH' THEN
            v_expected_asset := 'ETH';
            v_expected_contract := NULL;
            v_required_confirmations := 12;

        WHEN 'ERC20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract := '0xdac17f958d2ee523a2206206994597c13d831ec7';
            v_required_confirmations := 12;

        WHEN 'BEP20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract := '0x55d398326f99059ff775485246999027b3197955';
            v_required_confirmations := 15;

        WHEN 'TRC20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract := 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
            v_required_confirmations := 19;
    END CASE;

    IF v_norm_asset IS DISTINCT FROM v_expected_asset THEN
        RETURN jsonb_build_object('success', false, 'code', 'ASSET_NETWORK_MISMATCH', 'message', 'Asset ' || v_norm_asset || ' does not match expected asset ' || v_expected_asset || ' for network ' || v_norm_network);
    END IF;

    IF v_expected_contract IS NOT NULL THEN
        IF v_norm_contract IS NULL OR v_norm_contract IS DISTINCT FROM v_expected_contract THEN
            RETURN jsonb_build_object('success', false, 'code', 'INVALID_CONTRACT_ADDRESS', 'message', 'Invalid token contract for network ' || v_norm_network || '. Expected: ' || v_expected_contract);
        END IF;
    ELSE
        IF v_norm_contract IS NOT NULL THEN
            RETURN jsonb_build_object('success', false, 'code', 'UNEXPECTED_CONTRACT_ADDRESS', 'message', 'Native asset ' || v_norm_asset || ' must not include a contract address');
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 3. TRANSACTION ADVISORY LOCK (network + canonical tx_hash + output_index)
    -- ------------------------------------------------------------------------
    PERFORM pg_advisory_xact_lock(hashtext('deposit_' || v_norm_network || '_' || v_canonical_tx_hash || '_' || p_output_index::text));

    -- ------------------------------------------------------------------------
    -- 4. DEPOSIT ADDRESS ROUTING & OWNERSHIP VERIFICATION (Type-Safe Comparison)
    -- ------------------------------------------------------------------------
    IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
        SELECT user_id INTO v_user_id
        FROM public.user_deposit_addresses
        WHERE network::text = v_norm_network
          AND asset_symbol::text = v_norm_asset
          AND LOWER(BTRIM(address)) = v_canonical_address
        LIMIT 1;
    ELSE
        SELECT user_id INTO v_user_id
        FROM public.user_deposit_addresses
        WHERE network::text = v_norm_network
          AND asset_symbol::text = v_norm_asset
          AND BTRIM(address) = v_canonical_address
        LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'ADDRESS_NOT_FOUND', 'message', 'No active user account found matching deposit address ' || v_canonical_address || ' on ' || v_norm_network || ' for ' || v_norm_asset);
    END IF;

    -- ------------------------------------------------------------------------
    -- 5. WALLET STATUS VERIFICATION
    -- ------------------------------------------------------------------------
    SELECT id, status INTO v_wallet_id, v_wallet_status
    FROM public.wallets
    WHERE user_id = v_user_id;

    IF v_wallet_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'WALLET_NOT_FOUND', 'message', 'User primary wallet does not exist');
    END IF;

    IF v_wallet_status IS NULL OR v_wallet_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'code', 'WALLET_INACTIVE', 'message', 'User wallet is not active (status: ' || COALESCE(v_wallet_status, 'NULL') || ')');
    END IF;

    -- ------------------------------------------------------------------------
    -- 6. WALLET ASSET ROW LOCKING & NULL-BALANCE VALIDATION
    -- ------------------------------------------------------------------------
    SELECT id, balance INTO v_asset_id, v_prev_balance
    FROM public.wallet_assets
    WHERE user_id = v_user_id
      AND asset_symbol = v_norm_asset
    FOR UPDATE;

    IF v_asset_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_ASSET_NOT_PROVISIONED',
            'message', 'Wallet asset row not provisioned for user ' || v_user_id::text || ' and asset ' || v_norm_asset
        );
    END IF;

    IF v_prev_balance IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_BALANCE_INVALID',
            'message', 'Wallet asset balance is NULL; deposit credit refused'
        );
    END IF;

    -- ------------------------------------------------------------------------
    -- 7. CANONICAL TRANSACTION LOOKUP (FOR UPDATE)
    -- ------------------------------------------------------------------------
    SELECT * INTO v_existing_deposit
    FROM public.deposits
    WHERE LOWER(BTRIM(tx_hash)) = LOWER(BTRIM(p_tx_hash))
      AND chain = v_norm_network
      AND output_index = p_output_index
    FOR UPDATE;

    SELECT * INTO v_existing_onchain
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = LOWER(BTRIM(p_tx_hash))
      AND network = v_norm_network
      AND output_index = p_output_index
    FOR UPDATE;

    -- ------------------------------------------------------------------------
    -- 8. NULL-SAFE IMMUTABILITY, DESTINATION, SPLIT-STATE & STATE-MACHINE VALIDATION
    -- ------------------------------------------------------------------------
    IF v_existing_deposit.id IS NOT NULL OR v_existing_onchain.id IS NOT NULL THEN
        -- Check Split Table Inconsistency
        IF v_existing_deposit.id IS NULL OR v_existing_onchain.id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Split deposit record detected between public.deposits and public.onchain_deposits');
        END IF;

        -- Validate Immutable Fields on deposits (NULL-Safe via IS DISTINCT FROM)
        IF v_existing_deposit.user_id IS DISTINCT FROM v_user_id THEN
            RETURN jsonb_build_object('success', false, 'code', 'USER_MISMATCH', 'message', 'Deposits record user mismatch');
        END IF;

        IF v_existing_deposit.amount IS DISTINCT FROM p_amount THEN
            RETURN jsonb_build_object('success', false, 'code', 'AMOUNT_MISMATCH', 'message', 'Deposits record amount mismatch');
        END IF;

        IF v_existing_deposit.chain IS DISTINCT FROM v_norm_network THEN
            RETURN jsonb_build_object('success', false, 'code', 'NETWORK_MISMATCH', 'message', 'Deposits record chain mismatch');
        END IF;

        IF v_existing_deposit.token_symbol IS DISTINCT FROM v_norm_asset 
           OR v_existing_deposit.asset IS DISTINCT FROM v_norm_asset THEN
            RETURN jsonb_build_object('success', false, 'code', 'ASSET_MISMATCH', 'message', 'Deposits record asset mismatch');
        END IF;

        IF v_existing_deposit.output_index IS DISTINCT FROM p_output_index THEN
            RETURN jsonb_build_object('success', false, 'code', 'OUTPUT_INDEX_MISMATCH', 'message', 'Deposits record output_index mismatch');
        END IF;

        IF v_existing_deposit.to_address IS NOT NULL THEN
            IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
                v_existing_deposit_to_addr := LOWER(BTRIM(v_existing_deposit.to_address));
            ELSE
                v_existing_deposit_to_addr := BTRIM(v_existing_deposit.to_address);
            END IF;

            IF v_existing_deposit_to_addr IS DISTINCT FROM v_canonical_address THEN
                RETURN jsonb_build_object('success', false, 'code', 'DESTINATION_MISMATCH', 'message', 'Deposits to_address does not match canonical destination address');
            END IF;
        END IF;

        -- Validate Immutable Fields on onchain_deposits (NULL-Safe via IS DISTINCT FROM)
        IF v_existing_onchain.user_id IS DISTINCT FROM v_user_id THEN
            RETURN jsonb_build_object('success', false, 'code', 'USER_MISMATCH', 'message', 'Onchain record user mismatch');
        END IF;

        IF v_existing_onchain.amount IS DISTINCT FROM p_amount THEN
            RETURN jsonb_build_object('success', false, 'code', 'AMOUNT_MISMATCH', 'message', 'Onchain record amount mismatch');
        END IF;

        IF v_existing_onchain.network IS DISTINCT FROM v_norm_network THEN
            RETURN jsonb_build_object('success', false, 'code', 'NETWORK_MISMATCH', 'message', 'Onchain record network mismatch');
        END IF;

        IF v_existing_onchain.asset_symbol IS DISTINCT FROM v_norm_asset 
           OR v_existing_onchain.asset IS DISTINCT FROM v_norm_asset THEN
            RETURN jsonb_build_object('success', false, 'code', 'ASSET_MISMATCH', 'message', 'Onchain record asset mismatch');
        END IF;

        IF v_existing_onchain.output_index IS DISTINCT FROM p_output_index THEN
            RETURN jsonb_build_object('success', false, 'code', 'OUTPUT_INDEX_MISMATCH', 'message', 'Onchain record output_index mismatch');
        END IF;

        IF v_existing_onchain.required_confirmations IS DISTINCT FROM v_required_confirmations THEN
            RETURN jsonb_build_object('success', false, 'code', 'REQUIRED_CONFIRMATIONS_MISMATCH', 'message', 'Onchain required_confirmations does not match network configuration');
        END IF;

        -- Validate Destination Integrity on onchain_deposits (both address and to_address)
        IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
            v_existing_onchain_addr    := CASE WHEN v_existing_onchain.address IS NOT NULL THEN LOWER(BTRIM(v_existing_onchain.address)) ELSE NULL END;
            v_existing_onchain_to_addr := CASE WHEN v_existing_onchain.to_address IS NOT NULL THEN LOWER(BTRIM(v_existing_onchain.to_address)) ELSE NULL END;
        ELSE
            v_existing_onchain_addr    := CASE WHEN v_existing_onchain.address IS NOT NULL THEN BTRIM(v_existing_onchain.address) ELSE NULL END;
            v_existing_onchain_to_addr := CASE WHEN v_existing_onchain.to_address IS NOT NULL THEN BTRIM(v_existing_onchain.to_address) ELSE NULL END;
        END IF;

        IF v_existing_onchain_addr IS NOT NULL AND v_existing_onchain_addr IS DISTINCT FROM v_canonical_address THEN
            RETURN jsonb_build_object('success', false, 'code', 'DESTINATION_MISMATCH', 'message', 'Existing onchain address does not match canonical destination address');
        END IF;

        IF v_existing_onchain_to_addr IS NOT NULL AND v_existing_onchain_to_addr IS DISTINCT FROM v_canonical_address THEN
            RETURN jsonb_build_object('success', false, 'code', 'DESTINATION_MISMATCH', 'message', 'Existing onchain to_address does not match canonical destination address');
        END IF;

        -- Fail Closed on Unexpected Existing Status Combinations (NULL-safe evaluation)
        IF v_existing_onchain.status IS NULL 
           OR v_existing_deposit.status IS NULL
           OR NOT (
               (v_existing_onchain.status = 'PENDING' AND v_existing_deposit.status = 'PENDING')
               OR
               (v_existing_onchain.status = 'CREDITED' AND v_existing_deposit.status IN ('COMPLETED', 'CREDITED'))
           ) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DEPOSIT_STATE_INCONSISTENT',
                'message', 'Unexpected existing deposit status combination: onchain=' || COALESCE(v_existing_onchain.status, 'NULL') || ', deposits=' || COALESCE(v_existing_deposit.status, 'NULL')
            );
        END IF;

        -- Global Reference Already-Credited Ledger Integrity Assertion (NULL-Safe via IS DISTINCT FROM)
        IF v_existing_onchain.status = 'CREDITED' THEN
            -- Count ALL ledger entries globally for this deposit reference
            SELECT COUNT(*), (ARRAY_AGG(id))[1]
            INTO v_ledger_count, v_ledger_id
            FROM public.ledger_entries
            WHERE reference_id = v_existing_deposit.id::text;

            IF v_ledger_count IS DISTINCT FROM 1 THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'DEPOSIT_STATE_INCONSISTENT',
                    'message', 'Credited deposit has invalid global ledger entry count: ' || COALESCE(v_ledger_count::text, 'NULL')
                );
            END IF;

            SELECT * INTO v_existing_ledger
            FROM public.ledger_entries
            WHERE id = v_ledger_id;

            IF v_existing_ledger.user_id IS DISTINCT FROM v_user_id
               OR v_existing_ledger.type IS DISTINCT FROM 'deposit'
               OR v_existing_ledger.reference_id IS DISTINCT FROM v_existing_deposit.id::text
               OR v_existing_ledger.amount IS DISTINCT FROM p_amount
               OR v_existing_ledger.crypto IS DISTINCT FROM v_norm_asset
               OR v_existing_ledger.asset IS DISTINCT FROM v_norm_asset
               OR v_existing_ledger.chain IS DISTINCT FROM v_norm_network
               OR v_existing_ledger.status IS DISTINCT FROM 'completed' THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'DEPOSIT_STATE_INCONSISTENT',
                    'message', 'Existing deposit ledger entry contains conflicting financial data'
                );
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'ALREADY_CREDITED',
                'deposit_id', v_existing_deposit.id,
                'onchain_deposit_id', v_existing_onchain.id,
                'ledger_id', v_existing_ledger.id,
                'user_id', v_user_id,
                'asset', v_norm_asset,
                'amount', p_amount,
                'current_balance', v_prev_balance,
                'confirmations', v_existing_onchain.confirmations,
                'message', 'Deposit has already been verified, credited, and accounted in ledger'
            );
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 9. EFFECTIVE CONFIRMATIONS & MONOTONIC BLOCK NUMBER CALCULATION
    -- ------------------------------------------------------------------------
    v_effective_confirmations := GREATEST(
        COALESCE(p_confirmations, 0),
        COALESCE(v_existing_onchain.confirmations, 0)
    );

    v_is_confirmed := (v_effective_confirmations >= v_required_confirmations);

    -- Monotonic block number logic for deposits table
    IF v_existing_deposit.id IS NOT NULL THEN
        IF v_existing_deposit.block_number IS NOT NULL AND p_block_number IS NOT NULL THEN
            v_effective_block_number := GREATEST(v_existing_deposit.block_number, p_block_number);
        ELSIF v_existing_deposit.block_number IS NOT NULL THEN
            v_effective_block_number := v_existing_deposit.block_number;
        ELSE
            v_effective_block_number := p_block_number;
        END IF;
    ELSE
        v_effective_block_number := p_block_number;
    END IF;

    -- ------------------------------------------------------------------------
    -- 10. MUTATION: PENDING UPDATE OR ATOMIC BALANCE CREDITING
    -- ------------------------------------------------------------------------

    -- Case A: Deposit is not yet confirmed (remains PENDING)
    IF NOT v_is_confirmed THEN
        IF v_existing_deposit.id IS NOT NULL THEN
            UPDATE public.deposits
            SET block_number = v_effective_block_number
            WHERE id = v_existing_deposit.id;

            UPDATE public.onchain_deposits
            SET confirmations = v_effective_confirmations,
                updated_at    = NOW()
            WHERE id = v_existing_onchain.id;

            v_deposit_id := v_existing_deposit.id;
            v_onchain_id := v_existing_onchain.id;
        ELSE
            INSERT INTO public.deposits (
                user_id,
                chain,
                token_symbol,
                tx_hash,
                amount,
                from_address,
                to_address,
                status,
                block_number,
                created_at,
                asset,
                output_index
            ) VALUES (
                v_user_id,
                v_norm_network,
                v_norm_asset,
                v_canonical_tx_hash,
                p_amount,
                v_canonical_from,
                v_canonical_address,
                'PENDING',
                v_effective_block_number,
                NOW(),
                v_norm_asset,
                p_output_index
            )
            RETURNING id INTO v_deposit_id;

            INSERT INTO public.onchain_deposits (
                user_id,
                tx_hash,
                network,
                address,
                amount,
                asset_symbol,
                confirmations,
                required_confirmations,
                status,
                created_at,
                updated_at,
                to_address,
                asset,
                asset_code,
                network_code,
                output_index
            ) VALUES (
                v_user_id,
                v_canonical_tx_hash,
                v_norm_network,
                v_canonical_address,
                p_amount,
                v_norm_asset,
                v_effective_confirmations,
                v_required_confirmations,
                'PENDING',
                NOW(),
                NOW(),
                v_canonical_address,
                v_norm_asset,
                v_norm_asset,
                v_norm_network,
                p_output_index
            )
            RETURNING id INTO v_onchain_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'PENDING',
            'deposit_id', v_deposit_id,
            'onchain_deposit_id', v_onchain_id,
            'user_id', v_user_id,
            'asset', v_norm_asset,
            'amount', p_amount,
            'confirmations', v_effective_confirmations,
            'required_confirmations', v_required_confirmations,
            'message', 'Deposit recorded in PENDING state (' || v_effective_confirmations || '/' || v_required_confirmations || ' confirmations)'
        );
    END IF;

    -- Case B: Deposit is CONFIRMED -> Execute Atomic Balance Crediting
    -- Order of operations:
    -- 1. Obtain/create deposits row ID.
    -- 2. Globally verify no pre-existing ledger entry for this deposit reference.
    -- 3. Perform financial balance increment on wallet_assets.
    -- 4. Record authoritative ledger entry with reference_id = deposits.id::text.
    -- 5. Finalize deposit status to COMPLETED and onchain_deposits status to CREDITED.

    IF v_existing_deposit.id IS NOT NULL THEN
        v_deposit_id := v_existing_deposit.id;
    ELSE
        INSERT INTO public.deposits (
            user_id,
            chain,
            token_symbol,
            tx_hash,
            amount,
            from_address,
            to_address,
            status,
            block_number,
            created_at,
            asset,
            output_index
        ) VALUES (
            v_user_id,
            v_norm_network,
            v_norm_asset,
            v_canonical_tx_hash,
            p_amount,
            v_canonical_from,
            v_canonical_address,
            'COMPLETED',
            v_effective_block_number,
            NOW(),
            v_norm_asset,
            p_output_index
        )
        RETURNING id INTO v_deposit_id;
    END IF;

    -- 10.1 Global pre-mutation ledger check: ensure 0 ledger entries exist globally for this reference
    SELECT COUNT(*) INTO v_ledger_count
    FROM public.ledger_entries
    WHERE reference_id = v_deposit_id::text;

    IF v_ledger_count > 0 THEN
        RAISE EXCEPTION 'CRITICAL: Existing ledger entry already found globally for deposit %', v_deposit_id;
    END IF;

    -- 10.2 Execute financial balance mutation
    v_new_balance := v_prev_balance + p_amount;

    IF v_new_balance IS NULL THEN
        RAISE EXCEPTION 'CRITICAL: Resulting wallet balance evaluated to NULL for user % asset %', v_user_id, v_norm_asset;
    END IF;

    UPDATE public.wallet_assets
    SET balance    = v_new_balance,
        updated_at = NOW()
    WHERE id = v_asset_id;

    -- 10.3 Assert strict NULL-safe financial balance invariant
    IF (v_new_balance - v_prev_balance) IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'CRITICAL: Balance invariant violation. Expected increase %, actual delta %', p_amount, (v_new_balance - v_prev_balance);
    END IF;

    -- 10.4 Record authoritative ledger entry
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        created_at,
        asset,
        chain,
        status
    ) VALUES (
        v_user_id,
        v_norm_asset,
        p_amount,
        'deposit',
        v_deposit_id::text,
        v_new_balance,
        jsonb_build_object(
            'network', v_norm_network,
            'address', v_canonical_address,
            'from_address', v_canonical_from,
            'contract_address', v_norm_contract,
            'confirmations', v_effective_confirmations,
            'block_number', v_effective_block_number,
            'output_index', p_output_index,
            'provider', p_provider
        ),
        NOW(),
        v_norm_asset,
        v_norm_network,
        'completed'
    )
    RETURNING id INTO v_ledger_id;

    -- 10.5 Finalize deposits & onchain_deposits table states
    IF v_existing_deposit.id IS NOT NULL THEN
        UPDATE public.deposits
        SET status       = 'COMPLETED',
            block_number = v_effective_block_number
        WHERE id = v_existing_deposit.id;
    END IF;

    IF v_existing_onchain.id IS NOT NULL THEN
        UPDATE public.onchain_deposits
        SET status        = 'CREDITED',
            confirmations = v_effective_confirmations,
            updated_at    = NOW()
        WHERE id = v_existing_onchain.id;

        v_onchain_id := v_existing_onchain.id;
    ELSE
        INSERT INTO public.onchain_deposits (
            user_id,
            tx_hash,
            network,
            address,
            amount,
            asset_symbol,
            confirmations,
            required_confirmations,
            status,
            created_at,
            updated_at,
            to_address,
            asset,
            asset_code,
            network_code,
            output_index
        ) VALUES (
            v_user_id,
            v_canonical_tx_hash,
            v_norm_network,
            v_canonical_address,
            p_amount,
            v_norm_asset,
            v_effective_confirmations,
            v_required_confirmations,
            'CREDITED',
            NOW(),
            NOW(),
            v_canonical_address,
            v_norm_asset,
            v_norm_asset,
            v_norm_network,
            p_output_index
        )
        RETURNING id INTO v_onchain_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'CREDITED',
        'deposit_id', v_deposit_id,
        'onchain_deposit_id', v_onchain_id,
        'ledger_id', v_ledger_id,
        'user_id', v_user_id,
        'asset', v_norm_asset,
        'amount', p_amount,
        'previous_balance', v_prev_balance,
        'new_balance', v_new_balance,
        'confirmations', v_effective_confirmations,
        'message', 'Deposit successfully confirmed and credited to user balance'
    );
END;
$$;
