-- Persist independently verified canonical block hashes atomically with deposit processing.
-- Review on the fix branch before applying to any live project.
ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS block_hash text;
ALTER TABLE public.onchain_deposits ADD COLUMN IF NOT EXISTS block_hash text;

DROP FUNCTION public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text);

CREATE OR REPLACE FUNCTION public.process_deposit_atomic(p_destination_address text, p_asset_symbol text, p_network_code text, p_amount numeric, p_tx_hash text, p_output_index integer DEFAULT 0, p_block_number bigint DEFAULT NULL::bigint, p_from_address text DEFAULT NULL::text, p_token_contract text DEFAULT NULL::text, p_confirmations integer DEFAULT 0, p_provider text DEFAULT 'internal'::text, p_block_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

DECLARE
    v_network TEXT;
    v_asset TEXT;
    v_tx_hash TEXT;
    v_block_hash TEXT;
    v_address TEXT;
    v_from_address TEXT;
    v_contract TEXT;

    v_expected_asset TEXT;
    v_expected_contract TEXT;
    v_required_confirmations INTEGER;
    v_is_confirmed BOOLEAN;

    v_user_id UUID;
    v_wallet_id UUID;
    v_wallet_status TEXT;

    v_uda_count INTEGER;
    v_wallet_count INTEGER;

    v_asset_id UUID;
    v_previous_balance NUMERIC;
    v_new_balance NUMERIC;

    v_existing_deposit RECORD;
    v_existing_onchain RECORD;
    v_existing_ledger RECORD;

    v_deposit_id UUID;
    v_onchain_id UUID;
    v_ledger_id UUID;

    v_ledger_count INTEGER;

    v_effective_confirmations INTEGER;
    v_effective_block_number BIGINT;

BEGIN

    -- ================================================================
    -- BASIC VALIDATION
    -- ================================================================

    IF p_destination_address IS NULL
       OR BTRIM(p_destination_address) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_ADDRESS'
        );
    END IF;

    IF p_asset_symbol IS NULL
       OR BTRIM(p_asset_symbol) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_ASSET'
        );
    END IF;

    IF p_network_code IS NULL
       OR BTRIM(p_network_code) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_NETWORK'
        );
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_AMOUNT'
        );
    END IF;

    IF p_tx_hash IS NULL
       OR BTRIM(p_tx_hash) = '' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_TX_HASH'
        );
    END IF;

    IF p_output_index IS NULL OR p_output_index < 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_OUTPUT_INDEX'
        );
    END IF;

    IF p_confirmations IS NULL OR p_confirmations < 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_CONFIRMATIONS'
        );
    END IF;


    -- ================================================================
    -- NORMALIZATION
    -- ================================================================

    v_network := UPPER(BTRIM(p_network_code));
    v_asset := UPPER(BTRIM(p_asset_symbol));
    v_tx_hash := LOWER(BTRIM(p_tx_hash));

    -- Fail closed: every privileged deposit ingestion call must supply an
    -- independently verified canonical block hash. This prevents older or
    -- unreviewed callers from crediting funds without chain-canonicality proof.
    IF p_block_hash IS NULL OR BTRIM(p_block_hash) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'BLOCK_HASH_REQUIRED');
    END IF;

    IF length(p_block_hash) NOT IN (64, 66)
       OR (length(p_block_hash) = 66 AND lower(left(p_block_hash, 2)) <> '0x')
       OR (length(p_block_hash) = 64 AND p_block_hash !~* '^[0-9a-f]{64}')
       OR (length(p_block_hash) = 66 AND substring(p_block_hash from 3) !~* '^[0-9a-f]{64}') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_BLOCK_HASH');
    END IF;

    -- Persist block hashes in one canonical form. EVM providers may include
    -- a 0x prefix while other providers omit it; those represent the same hash.
    v_block_hash := LOWER(
        CASE
            WHEN LOWER(LEFT(BTRIM(p_block_hash), 2)) = '0x'
            THEN SUBSTRING(BTRIM(p_block_hash) FROM 3)
            ELSE BTRIM(p_block_hash)
        END
    );

    IF v_network IN ('ETH', 'ERC20', 'BEP20') THEN
        v_address := LOWER(BTRIM(p_destination_address));
    ELSE
        v_address := BTRIM(p_destination_address);
    END IF;

    IF p_from_address IS NOT NULL
       AND BTRIM(p_from_address) <> '' THEN

        IF v_network IN ('ETH', 'ERC20', 'BEP20') THEN
            v_from_address := LOWER(BTRIM(p_from_address));
        ELSE
            v_from_address := BTRIM(p_from_address);
        END IF;

    ELSE
        v_from_address := '';
    END IF;

    IF p_token_contract IS NOT NULL
       AND BTRIM(p_token_contract) <> '' THEN

        IF v_network IN ('ETH', 'ERC20', 'BEP20') THEN
            v_contract := LOWER(BTRIM(p_token_contract));
        ELSE
            v_contract := BTRIM(p_token_contract);
        END IF;

    ELSE
        v_contract := NULL;
    END IF;


    -- ================================================================
    -- NETWORK RULES
    -- ================================================================

    CASE v_network

        WHEN 'BTC' THEN
            v_expected_asset := 'BTC';
            v_expected_contract := NULL;
            v_required_confirmations := 3;

        WHEN 'LTC' THEN
            v_expected_asset := 'LTC';
            v_expected_contract := NULL;
            v_required_confirmations := 6;

        WHEN 'ETH' THEN
            v_expected_asset := 'ETH';
            v_expected_contract := NULL;
            v_required_confirmations := 12;

        WHEN 'ERC20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract :=
                '0xdac17f958d2ee523a2206206994597c13d831ec7';
            v_required_confirmations := 12;

        WHEN 'BEP20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract :=
                '0x55d398326f99059ff775485246999027b3197955';
            v_required_confirmations := 15;

        WHEN 'TRC20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract :=
                'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
            v_required_confirmations := 19;

        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'code', 'UNSUPPORTED_NETWORK',
                'network', v_network
            );

    END CASE;


    -- ================================================================
    -- ASSET VALIDATION
    -- ================================================================

    IF v_asset IS DISTINCT FROM v_expected_asset THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ASSET_NETWORK_MISMATCH',
            'network', v_network,
            'expected_asset', v_expected_asset,
            'received_asset', v_asset
        );
    END IF;


    IF v_expected_contract IS NULL THEN

        IF v_contract IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'UNEXPECTED_TOKEN_CONTRACT'
            );
        END IF;

    ELSE

        IF v_contract IS NULL
           OR v_contract IS DISTINCT FROM v_expected_contract THEN

            RETURN jsonb_build_object(
                'success', false,
                'code', 'INVALID_TOKEN_CONTRACT',
                'network', v_network
            );

        END IF;

    END IF;


    -- ================================================================
    -- TRANSACTION IDEMPOTENCY LOCK
    -- ================================================================

    PERFORM pg_advisory_xact_lock(
        hashtext(
            'deposit:' ||
            v_network || ':' ||
            v_tx_hash || ':' ||
            p_output_index::TEXT
        )
    );


    -- ================================================================
    -- EXISTING DEPOSIT
    -- ================================================================

    SELECT *
    INTO v_existing_deposit
    FROM public.deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_tx_hash
      AND UPPER(BTRIM(chain)) = v_network
      AND output_index = p_output_index
    FOR UPDATE;


    SELECT *
    INTO v_existing_onchain
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_tx_hash
      AND UPPER(BTRIM(network)) = v_network
      AND output_index = p_output_index
    FOR UPDATE;


    -- Only the current independently verified caller-supplied confirmation
    -- count may authorize credit. A persisted count can be stale after a reorg
    -- or provider inconsistency and must never elevate the current observation.
    v_effective_confirmations := COALESCE(p_confirmations, 0);

    v_is_confirmed :=
        v_effective_confirmations >= v_required_confirmations;


    -- ================================================================
    -- ADDRESS OWNERSHIP
    -- ================================================================

    -- Fail closed if legacy wallet records and canonical deposit-address
    -- records assign the same normalized address to different users.
    -- This check covers networks where the function supports both sources.
    IF EXISTS (
        SELECT 1
        FROM public.user_deposit_addresses uda
        JOIN public.wallets w
          ON LOWER(BTRIM(uda.address)) = LOWER(BTRIM(w.address))
         AND uda.user_id <> w.user_id
        WHERE UPPER(BTRIM(w.funding_status)) = 'ACTIVE'
          AND (
              (v_network = 'BTC'
               AND uda.network::TEXT = 'bitcoin'
               AND w.chain = 'BTC'
               AND BTRIM(uda.address) = BTRIM(v_address)
               AND BTRIM(w.address) = BTRIM(v_address))
              OR (v_network IN ('ETH', 'ERC20', 'BEP20')
                  AND uda.network::TEXT = 'ethereum'
                  AND w.chain = 'EVM'
                  AND LOWER(BTRIM(uda.address)) = LOWER(BTRIM(v_address))
                  AND LOWER(BTRIM(w.address)) = LOWER(BTRIM(v_address)))
              OR (v_network = 'TRC20'
                  AND uda.network::TEXT = 'TRC20'
                  AND w.chain = 'TRON'
                  AND BTRIM(uda.address) = BTRIM(v_address)
                  AND BTRIM(w.address) = BTRIM(v_address))
          )
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DEPOSIT_ADDRESS_OWNERSHIP_AMBIGUOUS',
            'message', 'Deposit address maps to conflicting user records; manual reconciliation required'
        );
    END IF;

    IF v_network = 'BTC' THEN

        SELECT COUNT(*)
        INTO v_uda_count
        FROM public.user_deposit_addresses
        WHERE network::TEXT = 'bitcoin'
          AND BTRIM(address) = BTRIM(v_address);

        IF v_uda_count > 1 THEN
            RAISE EXCEPTION
                'Multiple BTC owners found for address %',
                v_address;
        END IF;

        IF v_uda_count = 1 THEN

            SELECT user_id
            INTO v_user_id
            FROM public.user_deposit_addresses
            WHERE network::TEXT = 'bitcoin'
              AND BTRIM(address) = BTRIM(v_address);

        ELSE

            SELECT COUNT(*)
            INTO v_wallet_count
            FROM public.wallets
            WHERE chain = 'BTC'
              AND BTRIM(address) = BTRIM(v_address)
              AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';

            IF v_wallet_count > 1 THEN
                RAISE EXCEPTION
                    'Multiple BTC wallets found for address %',
                    v_address;
            END IF;

            IF v_wallet_count = 1 THEN
                SELECT user_id
                INTO v_user_id
                FROM public.wallets
                WHERE chain = 'BTC'
                  AND BTRIM(address) = BTRIM(v_address)
                  AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';
            END IF;

        END IF;


    ELSIF v_network = 'ETH' THEN

        SELECT COUNT(*)
        INTO v_uda_count
        FROM public.user_deposit_addresses
        WHERE network::TEXT = 'ethereum'
          AND LOWER(BTRIM(address)) = v_address;

        IF v_uda_count > 1 THEN
            RAISE EXCEPTION
                'Multiple ETH owners found for address %',
                v_address;
        END IF;

        IF v_uda_count = 1 THEN

            SELECT user_id
            INTO v_user_id
            FROM public.user_deposit_addresses
            WHERE network::TEXT = 'ethereum'
              AND LOWER(BTRIM(address)) = v_address;

        ELSE

            SELECT COUNT(*)
            INTO v_wallet_count
            FROM public.wallets
            WHERE chain = 'EVM'
              AND LOWER(BTRIM(address)) = v_address
              AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';

            IF v_wallet_count > 1 THEN
                RAISE EXCEPTION
                    'Multiple EVM wallets found for address %',
                    v_address;
            END IF;

            IF v_wallet_count = 1 THEN
                SELECT user_id
                INTO v_user_id
                FROM public.wallets
                WHERE chain = 'EVM'
                  AND LOWER(BTRIM(address)) = v_address
                  AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';
            END IF;

        END IF;


    ELSIF v_network IN ('ERC20', 'BEP20') THEN

        SELECT COUNT(*)
        INTO v_wallet_count
        FROM public.wallets
        WHERE chain = 'EVM'
          AND LOWER(BTRIM(address)) = v_address
          AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';

        IF v_wallet_count > 1 THEN
            RAISE EXCEPTION
                'Multiple EVM wallets found for address %',
                v_address;
        END IF;

        IF v_wallet_count = 1 THEN
            SELECT user_id
            INTO v_user_id
            FROM public.wallets
            WHERE chain = 'EVM'
              AND LOWER(BTRIM(address)) = v_address
              AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';
        END IF;


    ELSIF v_network = 'LTC' THEN

        SELECT COUNT(*)
        INTO v_wallet_count
        FROM public.wallets
        WHERE chain = 'LTC'
          AND BTRIM(address) = v_address
          AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';

        IF v_wallet_count > 1 THEN
            RAISE EXCEPTION
                'Multiple LTC wallets found for address %',
                v_address;
        END IF;

        IF v_wallet_count = 1 THEN
            SELECT user_id
            INTO v_user_id
            FROM public.wallets
            WHERE chain = 'LTC'
              AND BTRIM(address) = v_address
              AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';
        END IF;


    ELSIF v_network = 'TRC20' THEN

        SELECT COUNT(*)
        INTO v_uda_count
        FROM public.user_deposit_addresses
        WHERE network::TEXT = 'TRC20'
          AND BTRIM(address) = v_address;

        IF v_uda_count > 1 THEN
            RAISE EXCEPTION
                'Multiple TRC20 owners found for address %',
                v_address;
        END IF;

        IF v_uda_count = 1 THEN

            SELECT user_id
            INTO v_user_id
            FROM public.user_deposit_addresses
            WHERE network::TEXT = 'TRC20'
              AND BTRIM(address) = v_address;

        ELSE

            SELECT COUNT(*)
            INTO v_wallet_count
            FROM public.wallets
            WHERE chain = 'TRON'
              AND BTRIM(address) = v_address
              AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';

            IF v_wallet_count > 1 THEN
                RAISE EXCEPTION
                    'Multiple TRON wallets found for address %',
                    v_address;
            END IF;

            IF v_wallet_count = 1 THEN
                SELECT user_id
                INTO v_user_id
                FROM public.wallets
                WHERE chain = 'TRON'
                  AND BTRIM(address) = v_address
                  AND UPPER(COALESCE(funding_status, '')) = 'ACTIVE';
            END IF;

        END IF;

    END IF;


    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ADDRESS_NOT_FOUND',
            'network', v_network
        );
    END IF;


    -- ================================================================
    -- Existing transaction/output rows are immutable identities. Never let a
    -- retry with altered destination, owner, asset, network, or amount re-use
    -- an existing deposit ID and credit a different ledger identity.
    IF v_existing_deposit.id IS NOT NULL AND (
        v_existing_deposit.user_id IS DISTINCT FROM v_user_id
        OR UPPER(BTRIM(v_existing_deposit.chain)) IS DISTINCT FROM v_network
        OR UPPER(BTRIM(v_existing_deposit.token_symbol)) IS DISTINCT FROM v_asset
        OR UPPER(BTRIM(v_existing_deposit.asset)) IS DISTINCT FROM v_asset
        OR v_existing_deposit.amount IS DISTINCT FROM p_amount
        OR v_existing_deposit.output_index IS DISTINCT FROM p_output_index
        OR (CASE
              WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
              THEN LOWER(BTRIM(v_existing_deposit.to_address))
              ELSE BTRIM(v_existing_deposit.to_address)
            END) IS DISTINCT FROM v_address
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EXISTING_DEPOSIT_IDENTITY_MISMATCH',
            'message', 'Existing deposit identity does not match verified chain data'
        );
    END IF;

    IF v_existing_onchain.id IS NOT NULL AND (
        v_existing_onchain.user_id IS DISTINCT FROM v_user_id
        OR UPPER(BTRIM(v_existing_onchain.network)) IS DISTINCT FROM v_network
        OR UPPER(BTRIM(v_existing_onchain.asset_symbol)) IS DISTINCT FROM v_asset
        OR UPPER(BTRIM(v_existing_onchain.asset)) IS DISTINCT FROM v_asset
        OR v_existing_onchain.amount IS DISTINCT FROM p_amount
        OR v_existing_onchain.output_index IS DISTINCT FROM p_output_index
        OR (CASE
              WHEN v_network IN ('ETH', 'ERC20', 'BEP20')
              THEN LOWER(BTRIM(COALESCE(v_existing_onchain.to_address, v_existing_onchain.address)))
              ELSE BTRIM(COALESCE(v_existing_onchain.to_address, v_existing_onchain.address))
            END) IS DISTINCT FROM v_address
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'EXISTING_ONCHAIN_DEPOSIT_IDENTITY_MISMATCH',
            'message', 'Existing on-chain deposit identity does not match verified chain data'
        );
    END IF;

    IF p_block_hash IS NOT NULL AND (
        (v_existing_deposit.id IS NOT NULL AND v_existing_deposit.block_hash IS NOT NULL
          AND LOWER(v_existing_deposit.block_hash) IS DISTINCT FROM v_block_hash)
        OR
        (v_existing_onchain.id IS NOT NULL AND v_existing_onchain.block_hash IS NOT NULL
          AND LOWER(v_existing_onchain.block_hash) IS DISTINCT FROM v_block_hash)
    ) THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_BLOCK_HASH_MISMATCH',
          'message', 'Verified block hash differs from the stored deposit block hash');
    END IF;

    -- A deposit that already has a ledger credit must never be downgraded
    -- to PENDING by a later lower confirmation observation. This function does
    -- not reverse funds on a suspected reorg; return for operator reconciliation.
    IF NOT v_is_confirmed AND v_existing_deposit.id IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_ledger_count
        FROM public.ledger_entries
        WHERE reference_id = v_existing_deposit.id::TEXT
          AND type = 'deposit';

        IF v_ledger_count > 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'CONFIRMED_DEPOSIT_CONFIRMATIONS_REGRESSED',
                'message', 'Previously credited deposit needs reorg review; no status or balance changes were made'
            );
        END IF;
    END IF;

    -- PENDING DEPOSIT
    -- ================================================================

    IF NOT v_is_confirmed THEN

        IF v_existing_deposit.id IS NOT NULL THEN

            UPDATE public.deposits
            SET block_number =
                    CASE
                        WHEN block_number IS NOT NULL
                             AND p_block_number IS NOT NULL
                        THEN GREATEST(block_number, p_block_number)
                        ELSE COALESCE(block_number, p_block_number)
                    END,
                status = 'PENDING',
                block_hash = COALESCE(v_block_hash, block_hash)
            WHERE id = v_existing_deposit.id;

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
                output_index,
                block_number,
                block_hash
            )
            VALUES (
                v_user_id,
                v_network,
                v_asset,
                v_tx_hash,
                p_amount,
                NULLIF(v_from_address, ''),
                v_address,
                'PENDING',
                p_block_number,
                NOW(),
                v_asset,
                p_output_index,
                v_block_hash
            )
            RETURNING id INTO v_deposit_id;

        END IF;


        IF v_existing_onchain.id IS NOT NULL THEN

            UPDATE public.onchain_deposits
            SET confirmations =
                    GREATEST(
                        COALESCE(confirmations, 0),
                        v_effective_confirmations
                    ),
                required_confirmations = v_required_confirmations,
                block_number = COALESCE(p_block_number, block_number),
                block_hash = COALESCE(v_block_hash, block_hash),
                updated_at = NOW()
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
                output_index,
                block_number,
                block_hash
            )
            VALUES (
                v_user_id,
                v_tx_hash,
                v_network,
                v_address,
                p_amount,
                v_asset,
                v_effective_confirmations,
                v_required_confirmations,
                'PENDING',
                NOW(),
                NOW(),
                v_address,
                v_asset,
                v_asset,
                v_network,
                p_output_index,
                p_block_number,
                v_block_hash
            )
            RETURNING id INTO v_onchain_id;

        END IF;


        RETURN jsonb_build_object(
            'success', true,
            'status', 'PENDING',
            'credited', false,
            'deposit_id', v_deposit_id,
            'onchain_deposit_id', v_onchain_id,
            'user_id', v_user_id,
            'asset', v_asset,
            'network', v_network,
            'amount', p_amount,
            'confirmations', v_effective_confirmations,
            'required_confirmations', v_required_confirmations
        );

    END IF;


    -- ================================================================
    -- LOCK AUTHORITATIVE wallet_assets ROW
    -- ================================================================

    PERFORM pg_advisory_xact_lock(
        hashtext(
            'wallet_asset:' ||
            v_user_id::TEXT || ':' ||
            v_asset
        )
    );

    SELECT id, balance
    INTO v_asset_id, v_previous_balance
    FROM public.wallet_assets
    WHERE user_id = v_user_id
      AND asset_symbol = v_asset
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_ASSET_NOT_PROVISIONED',
            'asset', v_asset
        );
    END IF;

    -- The live schema permits NULL balances; never let NULL arithmetic silently
    -- produce a successful deposit response without a real balance update.
    IF v_previous_balance IS NULL OR v_previous_balance < 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_BALANCE_INVALID',
            'message', 'Wallet balance is null or negative; manual reconciliation required'
        );
    END IF;


    -- ================================================================
    -- ENSURE DEPOSIT RECORD
    -- ================================================================

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
            output_index,
            block_hash
        )
        VALUES (
            v_user_id,
            v_network,
            v_asset,
            v_tx_hash,
            p_amount,
            COALESCE(NULLIF(v_from_address, ''), ''),
            v_address,
            'CONFIRMED',
            p_block_number,
            NOW(),
            v_asset,
            p_output_index,
            v_block_hash
        )
        RETURNING id INTO v_deposit_id;

    END IF;


    -- ================================================================
    -- LEDGER IDEMPOTENCY
    -- ================================================================

    SELECT COUNT(*)
    INTO v_ledger_count
    FROM public.ledger_entries
    WHERE reference_id = v_deposit_id::TEXT
      AND type = 'deposit';

    IF v_ledger_count > 1 THEN
        RAISE EXCEPTION
            'Multiple ledger entries found for deposit %',
            v_deposit_id;
    END IF;


    IF v_ledger_count = 1 THEN

        SELECT *
        INTO v_existing_ledger
        FROM public.ledger_entries
        WHERE reference_id = v_deposit_id::TEXT
          AND type = 'deposit';

        IF v_existing_ledger.user_id IS DISTINCT FROM v_user_id
           OR v_existing_ledger.type IS DISTINCT FROM 'deposit'
           OR v_existing_ledger.amount IS DISTINCT FROM p_amount
           OR v_existing_ledger.crypto IS DISTINCT FROM v_asset
           OR v_existing_ledger.asset IS DISTINCT FROM v_asset THEN

            RAISE EXCEPTION
                'Existing ledger entry is inconsistent for deposit %',
                v_deposit_id;

        END IF;

        SELECT id
        INTO v_onchain_id
        FROM public.onchain_deposits
        WHERE LOWER(BTRIM(tx_hash)) = v_tx_hash
          AND UPPER(BTRIM(network)) = v_network
          AND output_index = p_output_index;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'ALREADY_CREDITED',
            'credited', false,
            'already_credited', true,
            'deposit_id', v_deposit_id,
            'onchain_deposit_id', v_onchain_id,
            'ledger_id', v_existing_ledger.id,
            'user_id', v_user_id,
            'asset', v_asset,
            'network', v_network,
            'amount', p_amount,
            'current_balance', v_previous_balance
        );

    END IF;


    -- ================================================================
    -- CREDIT wallet_assets.balance ONLY
    --
    -- DO NOT TOUCH:
    -- locked_balance
    -- reserved_balance
    -- in_escrow
    -- in_withdrawal
    -- ================================================================

    v_new_balance := v_previous_balance + p_amount;

    UPDATE public.wallet_assets
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE id = v_asset_id;


    -- ================================================================
    -- LEDGER
    -- ================================================================

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
    )
    VALUES (
        v_user_id,
        v_asset,
        p_amount,
        'deposit',
        v_deposit_id::TEXT,
        v_new_balance,
        jsonb_build_object(
            'network', v_network,
            'address', v_address,
            'from_address', NULLIF(v_from_address, ''),
            'contract_address', v_contract,
            'confirmations', v_effective_confirmations,
            'required_confirmations', v_required_confirmations,
            'block_number', p_block_number,
            'output_index', p_output_index,
            'provider', p_provider
        ),
        NOW(),
        v_asset,
        v_network,
        'completed'
    )
    RETURNING id INTO v_ledger_id;


    -- ================================================================
    -- FINALIZE DEPOSIT
    -- ================================================================

    UPDATE public.deposits
    SET status = 'CONFIRMED',
        block_number =
            CASE
                WHEN block_number IS NOT NULL
                     AND p_block_number IS NOT NULL
                THEN GREATEST(block_number, p_block_number)
                ELSE COALESCE(block_number, p_block_number)
            END,
        block_hash = COALESCE(v_block_hash, block_hash)
    WHERE id = v_deposit_id;


    -- ================================================================
    -- FINALIZE ON-CHAIN DEPOSIT
    -- ================================================================

    IF v_existing_onchain.id IS NOT NULL THEN

        UPDATE public.onchain_deposits
        SET confirmations =
                GREATEST(
                    COALESCE(confirmations, 0),
                    v_effective_confirmations
                ),
            required_confirmations = v_required_confirmations,
            status = 'CONFIRMED',
            block_number = COALESCE(p_block_number, block_number),
            block_hash = COALESCE(v_block_hash, block_hash),
            updated_at = NOW()
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
            output_index,
            block_hash
        )
        VALUES (
            v_user_id,
            v_tx_hash,
            v_network,
            v_address,
            p_amount,
            v_asset,
            v_effective_confirmations,
            v_required_confirmations,
            'CONFIRMED',
            NOW(),
            NOW(),
            v_address,
            v_asset,
            v_asset,
            v_network,
            p_output_index,
            v_block_hash
        )
        RETURNING id INTO v_onchain_id;

    END IF;


    RETURN jsonb_build_object(
        'success', true,
        'status', 'CONFIRMED',
        'credited', true,
        'already_credited', false,
        'deposit_id', v_deposit_id,
        'onchain_deposit_id', v_onchain_id,
        'ledger_id', v_ledger_id,
        'user_id', v_user_id,
        'asset', v_asset,
        'network', v_network,
        'amount', p_amount,
        'previous_balance', v_previous_balance,
        'new_balance', v_new_balance,
        'confirmations', v_effective_confirmations,
        'required_confirmations', v_required_confirmations
    );

END;
$function$;

REVOKE ALL ON FUNCTION public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text,text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text,text) TO service_role;
