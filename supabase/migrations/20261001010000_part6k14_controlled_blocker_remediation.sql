-- ============================================================================
-- MIGRATION: 20261001010000_part6k14_controlled_blocker_remediation.sql
-- TARGET: Paxones Database (Supabase PostgreSQL)
-- DESCRIPTION: Part 6K.14 Production Blocker Remediation:
--              1. Hardens public.process_deposit_atomic() with hybrid destination address resolution
--              2. Ensures public.onchain_deposits uses canonical 'CONFIRMED' status
--              3. Strictly protects wallet_assets balance mutation and ledger idempotency
--              4. Ensures complete P2P escrow/trade isolation
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- STEP 1: PRE-MIGRATION IMMUTABLE BASELINE SNAPSHOTS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._snapshot_6k14o_user_deposit_addresses (
    id UUID PRIMARY KEY,
    user_id UUID,
    network TEXT,
    address TEXT,
    asset_symbol TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    chain TEXT,
    asset_code TEXT,
    network_code TEXT,
    migration_id TEXT NOT NULL DEFAULT '6K.14O',
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public._snapshot_6k14o_functions (
    function_signature TEXT PRIMARY KEY,
    definition TEXT NOT NULL,
    migration_id TEXT NOT NULL DEFAULT '6K.14O',
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public._snapshot_6k14o_constraints (
    constraint_name TEXT PRIMARY KEY,
    definition TEXT NOT NULL,
    migration_id TEXT NOT NULL DEFAULT '6K.14O',
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public._snapshot_6k14o_wallets (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    chain TEXT NOT NULL,
    address TEXT NOT NULL,
    funding_status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    migration_id TEXT NOT NULL DEFAULT '6K.14O',
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public._snapshot_6k14o_p2p_baseline (
    id UUID PRIMARY KEY,
    status TEXT NOT NULL,
    crypto_amount NUMERIC NOT NULL,
    escrow_fee NUMERIC NOT NULL,
    migration_id TEXT NOT NULL DEFAULT '6K.14O',
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Snapshot existing records safely if empty
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public._snapshot_6k14o_user_deposit_addresses) THEN
        INSERT INTO public._snapshot_6k14o_user_deposit_addresses (
            id, user_id, network, address, asset_symbol, created_at, updated_at, chain, asset_code, network_code
        )
        SELECT id, user_id, network::text, address, asset_symbol, created_at, updated_at, chain, asset_code, network_code
        FROM public.user_deposit_addresses;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public._snapshot_6k14o_functions WHERE function_signature = 'process_deposit_atomic') THEN
        INSERT INTO public._snapshot_6k14o_functions (function_signature, definition)
        SELECT 'process_deposit_atomic', pg_get_functiondef(p.oid)
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'process_deposit_atomic'
        LIMIT 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public._snapshot_6k14o_constraints WHERE constraint_name = 'onchain_deposits_status_check') THEN
        INSERT INTO public._snapshot_6k14o_constraints (constraint_name, definition)
        SELECT 'onchain_deposits_status_check', pg_get_constraintdef(c.oid)
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        WHERE n.nspname = 'public' AND t.relname = 'onchain_deposits' AND c.conname = 'onchain_deposits_status_check'
        LIMIT 1;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public._snapshot_6k14o_wallets) THEN
        INSERT INTO public._snapshot_6k14o_wallets (id, user_id, chain, address, funding_status, created_at, updated_at)
        SELECT id, user_id, chain, address, funding_status, created_at, updated_at
        FROM public.wallets;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public._snapshot_6k14o_p2p_baseline) THEN
        INSERT INTO public._snapshot_6k14o_p2p_baseline (id, status, crypto_amount, escrow_fee)
        SELECT id, status, COALESCE(crypto_amount, amount), COALESCE(escrow_fee, platform_fee, 0)
        FROM public.trades;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 2: VERIFY onchain_deposits_status_check CONSTRAINT
-- ----------------------------------------------------------------------------
ALTER TABLE public.onchain_deposits 
    DROP CONSTRAINT IF EXISTS onchain_deposits_status_check;

ALTER TABLE public.onchain_deposits 
    ADD CONSTRAINT onchain_deposits_status_check 
    CHECK ((status)::text = ANY (ARRAY['PENDING'::character varying, 'CONFIRMED'::character varying, 'FAILED'::character varying]::text[]));

-- ----------------------------------------------------------------------------
-- STEP 3: REDEPLOY process_deposit_atomic (HYBRID ROUTING & 'CONFIRMED' STATUS)
-- ----------------------------------------------------------------------------
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
    v_expected_wallet_chain text;
    v_required_confirmations integer;
    v_effective_confirmations integer;
    v_is_confirmed boolean;
    v_effective_block_number bigint;

    -- Routing & Wallet records
    v_user_id uuid;
    v_user_count integer;
    v_wallet_id uuid;
    v_wallet_status text;
    v_wallet_count integer;
    v_asset_id uuid;
    v_asset_count integer;
    v_prev_balance numeric;
    v_new_balance numeric;

    -- State tracking & Scalar-typed Deposit records (avoids uninitialized record errors)
    v_has_existing_deposit boolean := false;
    v_has_existing_onchain boolean := false;

    v_dep_match_count integer;
    v_matched_dep_id uuid;
    v_deposit_id uuid;
    v_existing_dep_user_id uuid;
    v_existing_dep_chain text;
    v_existing_dep_token_symbol text;
    v_existing_dep_amount numeric;
    v_existing_dep_from_address text;
    v_existing_dep_to_address text;
    v_existing_dep_status text;
    v_existing_dep_block_number bigint;
    v_existing_dep_asset text;

    v_onchain_match_count integer;
    v_matched_onchain_id uuid;
    v_onchain_id uuid;
    v_existing_onchain_user_id uuid;
    v_existing_onchain_network text;
    v_existing_onchain_asset_symbol text;
    v_existing_onchain_address text;
    v_existing_onchain_to_address text;
    v_existing_onchain_amount numeric;
    v_existing_onchain_status text;
    v_existing_onchain_confirmations integer;
    v_existing_onchain_req_confirmations integer;

    -- Ledger verification
    v_matched_ledger_id uuid;
    v_ledger_count integer;
    v_existing_ledger_user_id uuid;
    v_existing_ledger_type text;
    v_existing_ledger_amount numeric;
    v_ledger_id uuid;

    -- Address comparison
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

    -- Normalize network and asset symbols to UPPERCASE
    v_norm_network := UPPER(BTRIM(p_network_code));
    v_norm_asset := UPPER(BTRIM(p_asset_symbol));
    v_norm_contract := NULLIF(BTRIM(p_token_contract), '');

    -- Canonical normalization of hashes and addresses based on network
    v_canonical_tx_hash := LOWER(BTRIM(p_tx_hash));
    
    -- EVM networks use lowercase address normalization; UTXO/TRON preserve exact casing
    IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
        v_canonical_address := LOWER(BTRIM(p_destination_address));
        IF p_from_address IS NOT NULL AND BTRIM(p_from_address) <> '' THEN
            v_canonical_from := LOWER(BTRIM(p_from_address));
        ELSE
            v_canonical_from := NULL;
        END IF;
    ELSE
        v_canonical_address := BTRIM(p_destination_address);
        IF p_from_address IS NOT NULL AND BTRIM(p_from_address) <> '' THEN
            v_canonical_from := BTRIM(p_from_address);
        ELSE
            v_canonical_from := NULL;
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 2. CANONICAL NETWORK, ASSET & TOKEN CONTRACT VALIDATION (6 PRODUCTION NETWORKS ONLY)
    -- ------------------------------------------------------------------------
    CASE v_norm_network
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
            v_expected_contract := '0xdAC17F958D2ee523a2206206994597C13D831ec7';
            v_required_confirmations := 12;

        WHEN 'BEP20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract := '0x55d398326f99059fF775485246999027B3197955';
            v_required_confirmations := 15;

        WHEN 'TRC20' THEN
            v_expected_asset := 'USDT';
            v_expected_contract := 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
            v_required_confirmations := 19;

        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'code', 'UNSUPPORTED_NETWORK',
                'message', 'Network ' || v_norm_network || ' is not supported in production'
            );
    END CASE;

    -- Verify Asset Match
    IF v_norm_asset <> v_expected_asset THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ASSET_NETWORK_MISMATCH',
            'message', 'Asset ' || v_norm_asset || ' is not supported on network ' || v_norm_network
        );
    END IF;

    -- Verify Token Contract for Tokens (ERC20 / BEP20 / TRC20)
    IF v_expected_contract IS NOT NULL THEN
        IF v_norm_contract IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'CONTRACT_REQUIRED',
                'message', 'Token contract address is required for ' || v_norm_network
            );
        END IF;

        IF v_norm_network IN ('ERC20', 'BEP20') THEN
            IF LOWER(v_norm_contract) <> LOWER(v_expected_contract) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'INVALID_CONTRACT',
                    'message', 'Invalid contract address ' || v_norm_contract || ' for ' || v_norm_network
                );
            END IF;
        ELSIF v_norm_network = 'TRC20' THEN
            IF v_norm_contract <> v_expected_contract THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'code', 'INVALID_CONTRACT',
                    'message', 'Invalid contract address ' || v_norm_contract || ' for TRC20'
                );
            END IF;
        END IF;
    ELSE
        -- Native assets must not provide a token contract
        IF v_norm_contract IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'CONTRACT_NOT_PERMITTED',
                'message', 'Contract address is not permitted for native network ' || v_norm_network
            );
        END IF;
    END IF;

    -- ------------------------------------------------------------------------
    -- 3. TRANSACTION ADVISORY LOCKING (PREVENTS RACE CONDITIONS)
    -- ------------------------------------------------------------------------
    PERFORM pg_advisory_xact_lock(hashtext('deposit:' || v_norm_network || ':' || v_canonical_tx_hash || ':' || p_output_index::text));

    -- ------------------------------------------------------------------------
    -- 4. HYBRID DESTINATION ADDRESS RESOLUTION (NO LIMIT 1)
    -- ------------------------------------------------------------------------
    CASE v_norm_network
        WHEN 'BTC' THEN
            SELECT COUNT(*), MIN(user_id)
            INTO v_user_count, v_user_id
            FROM (
                SELECT uda.user_id FROM public.user_deposit_addresses uda
                WHERE BTRIM(uda.address) = v_canonical_address AND (uda.network::text = 'bitcoin' OR uda.network_code = 'bitcoin')
                UNION
                SELECT w.user_id FROM public.wallets w
                WHERE BTRIM(w.address) = v_canonical_address AND w.chain = 'BTC'
            ) sub;

        WHEN 'LTC' THEN
            SELECT COUNT(*), MIN(w.user_id)
            INTO v_user_count, v_user_id
            FROM public.wallets w
            WHERE BTRIM(w.address) = v_canonical_address AND w.chain = 'LTC';

        WHEN 'ETH' THEN
            SELECT COUNT(*), MIN(user_id)
            INTO v_user_count, v_user_id
            FROM (
                SELECT uda.user_id FROM public.user_deposit_addresses uda
                WHERE LOWER(BTRIM(uda.address)) = v_canonical_address AND (uda.network::text = 'ethereum' OR uda.network_code = 'ethereum')
                UNION
                SELECT w.user_id FROM public.wallets w
                WHERE LOWER(BTRIM(w.address)) = v_canonical_address AND w.chain = 'EVM'
            ) sub;

        WHEN 'ERC20' THEN
            SELECT COUNT(*), MIN(w.user_id)
            INTO v_user_count, v_user_id
            FROM public.wallets w
            WHERE LOWER(BTRIM(w.address)) = v_canonical_address AND w.chain = 'EVM';

        WHEN 'BEP20' THEN
            SELECT COUNT(*), MIN(w.user_id)
            INTO v_user_count, v_user_id
            FROM public.wallets w
            WHERE LOWER(BTRIM(w.address)) = v_canonical_address AND w.chain = 'EVM';

        WHEN 'TRC20' THEN
            SELECT COUNT(*), MIN(user_id)
            INTO v_user_count, v_user_id
            FROM (
                SELECT uda.user_id FROM public.user_deposit_addresses uda
                WHERE BTRIM(uda.address) = v_canonical_address AND (uda.network::text = 'TRC20' OR uda.network_code = 'TRC20')
                UNION
                SELECT w.user_id FROM public.wallets w
                WHERE BTRIM(w.address) = v_canonical_address AND w.chain = 'TRON'
            ) sub;

        ELSE
            v_user_count := 0;
    END CASE;

    -- Legacy fallback check on deposit_addresses if user_count is 0
    IF v_user_count = 0 THEN
        IF v_norm_network = 'BTC' THEN
            SELECT COUNT(*), MIN(da.user_id) INTO v_user_count, v_user_id
            FROM public.deposit_addresses da
            WHERE BTRIM(da.address) = v_canonical_address AND UPPER(BTRIM(da.chain)) IN ('BTC', 'BITCOIN');
        ELSIF v_norm_network = 'LTC' THEN
            SELECT COUNT(*), MIN(da.user_id) INTO v_user_count, v_user_id
            FROM public.deposit_addresses da
            WHERE BTRIM(da.address) = v_canonical_address AND UPPER(BTRIM(da.chain)) IN ('LTC', 'LITECOIN');
        ELSIF v_norm_network = 'ETH' AND v_norm_asset = 'ETH' THEN
            SELECT COUNT(*), MIN(da.user_id) INTO v_user_count, v_user_id
            FROM public.deposit_addresses da
            WHERE LOWER(BTRIM(da.address)) = v_canonical_address AND UPPER(BTRIM(da.chain)) IN ('ETH', 'ETHEREUM');
        ELSIF v_norm_network = 'TRC20' THEN
            SELECT COUNT(*), MIN(da.user_id) INTO v_user_count, v_user_id
            FROM public.deposit_addresses da
            WHERE BTRIM(da.address) = v_canonical_address AND UPPER(BTRIM(da.chain)) IN ('TRC20', 'TRON');
        END IF;
    END IF;

    IF v_user_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ADDRESS_NOT_FOUND',
            'message', 'Destination address ' || p_destination_address || ' on network ' || v_norm_network || ' is not registered to any user'
        );
    ELSIF v_user_count > 1 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ADDRESS_CARDINALITY_CONFLICT',
            'message', 'Multiple user accounts matched destination address ' || p_destination_address || ' on network ' || v_norm_network
        );
    END IF;

    -- ------------------------------------------------------------------------
    -- 5. DETERMINISTIC CHAIN WALLET RESOLUTION & CARDINALITY (NO LIMIT 1)
    -- ------------------------------------------------------------------------
    CASE v_norm_network
        WHEN 'BTC' THEN v_expected_wallet_chain := 'BTC';
        WHEN 'LTC' THEN v_expected_wallet_chain := 'LTC';
        WHEN 'ETH' THEN v_expected_wallet_chain := 'EVM';
        WHEN 'ERC20' THEN v_expected_wallet_chain := 'EVM';
        WHEN 'BEP20' THEN v_expected_wallet_chain := 'EVM';
        WHEN 'TRC20' THEN v_expected_wallet_chain := 'TRON';
        ELSE v_expected_wallet_chain := NULL;
    END CASE;

    IF v_expected_wallet_chain IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNSUPPORTED_WALLET_CHAIN', 'message', 'No multi-chain wallet configuration for network ' || v_norm_network);
    END IF;

    -- Assert exactly 1 wallet exists for (user_id, chain)
    SELECT COUNT(*), MIN(id), MIN(funding_status)
    INTO v_wallet_count, v_wallet_id, v_wallet_status
    FROM public.wallets
    WHERE user_id = v_user_id
      AND chain = v_expected_wallet_chain;

    IF v_wallet_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'WALLET_NOT_FOUND', 'message', 'Active multi-chain wallet for chain ' || v_expected_wallet_chain || ' not provisioned for user');
    ELSIF v_wallet_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'WALLET_CARDINALITY_CONFLICT', 'message', 'Multiple multi-chain wallets found for chain ' || v_expected_wallet_chain || ' for user');
    END IF;

    IF v_wallet_status IS NULL OR UPPER(BTRIM(v_wallet_status)) <> 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'code', 'WALLET_SUSPENDED', 'message', 'Multi-chain wallet is not active for funding');
    END IF;

    -- ------------------------------------------------------------------------
    -- 6. EXISTING RECORD LOOKUP & IMMUTABLE INVARIANT VALIDATION (NO LIMIT 1)
    -- ------------------------------------------------------------------------
    SELECT COUNT(*), MIN(id)
    INTO v_dep_match_count, v_matched_dep_id
    FROM public.deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_canonical_tx_hash
      AND UPPER(BTRIM(chain)) = v_norm_network
      AND COALESCE(output_index, 0) = p_output_index;

    IF v_dep_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_CARDINALITY_CONFLICT', 'message', 'Multiple core deposit records match transaction key');
    ELSIF v_dep_match_count = 1 THEN
        v_has_existing_deposit := true;
        v_deposit_id := v_matched_dep_id;
        SELECT user_id, chain, token_symbol, amount, from_address, to_address, status, block_number, asset
        INTO v_existing_dep_user_id, v_existing_dep_chain, v_existing_dep_token_symbol, v_existing_dep_amount,
             v_existing_dep_from_address, v_existing_dep_to_address, v_existing_dep_status, v_existing_dep_block_number, v_existing_dep_asset
        FROM public.deposits
        WHERE id = v_matched_dep_id;
    END IF;

    SELECT COUNT(*), MIN(id)
    INTO v_onchain_match_count, v_matched_onchain_id
    FROM public.onchain_deposits
    WHERE LOWER(BTRIM(tx_hash)) = v_canonical_tx_hash
      AND UPPER(BTRIM(network)) = v_norm_network
      AND COALESCE(output_index, 0) = p_output_index;

    IF v_onchain_match_count > 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'ONCHAIN_CARDINALITY_CONFLICT', 'message', 'Multiple onchain deposit records match transaction key');
    ELSIF v_onchain_match_count = 1 THEN
        v_has_existing_onchain := true;
        v_onchain_id := v_matched_onchain_id;
        SELECT user_id, network, asset_symbol, address, to_address, amount, status, confirmations, required_confirmations
        INTO v_existing_onchain_user_id, v_existing_onchain_network, v_existing_onchain_asset_symbol,
             v_existing_onchain_address, v_existing_onchain_to_address, v_existing_onchain_amount,
             v_existing_onchain_status, v_existing_onchain_confirmations, v_existing_onchain_req_confirmations
        FROM public.onchain_deposits
        WHERE id = v_matched_onchain_id;
    END IF;

    -- Validate consistency if either record exists
    IF v_has_existing_deposit OR v_has_existing_onchain THEN
        IF NOT v_has_existing_deposit OR NOT v_has_existing_onchain THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Deposit record split across tracking tables');
        END IF;

        -- Immutable User ID Check
        IF v_existing_dep_user_id IS DISTINCT FROM v_user_id OR v_existing_onchain_user_id IS DISTINCT FROM v_user_id THEN
            RETURN jsonb_build_object('success', false, 'code', 'USER_MISMATCH', 'message', 'Deposit belongs to a different user');
        END IF;

        -- Immutable Amount Check
        IF v_existing_dep_amount IS DISTINCT FROM p_amount OR v_existing_onchain_amount IS DISTINCT FROM p_amount THEN
            RETURN jsonb_build_object('success', false, 'code', 'AMOUNT_MISMATCH', 'message', 'Deposit amount cannot be modified');
        END IF;

        -- Immutable Destination Address Check
        IF v_norm_network IN ('ETH', 'ERC20', 'BEP20') THEN
            v_existing_onchain_addr := LOWER(BTRIM(v_existing_onchain_address));
            v_existing_onchain_to_addr := LOWER(BTRIM(COALESCE(v_existing_onchain_to_address, v_existing_onchain_address)));
            v_existing_deposit_to_addr := LOWER(BTRIM(COALESCE(v_existing_dep_to_address, '')));
        ELSE
            v_existing_onchain_addr := BTRIM(v_existing_onchain_address);
            v_existing_onchain_to_addr := BTRIM(COALESCE(v_existing_onchain_to_address, v_existing_onchain_address));
            v_existing_deposit_to_addr := BTRIM(COALESCE(v_existing_dep_to_address, ''));
        END IF;

        IF (v_existing_onchain_address IS NOT NULL AND v_existing_onchain_addr IS DISTINCT FROM v_canonical_address)
           OR (v_existing_onchain_to_address IS NOT NULL AND v_existing_onchain_to_addr IS DISTINCT FROM v_canonical_address)
           OR (v_existing_dep_to_address IS NOT NULL AND v_existing_deposit_to_addr IS DISTINCT FROM v_canonical_address) THEN
            RETURN jsonb_build_object('success', false, 'code', 'DESTINATION_MISMATCH', 'message', 'Destination address cannot be modified');
        END IF;

        -- Immutable Asset / Symbol Check
        IF (v_existing_dep_asset IS NOT NULL AND UPPER(BTRIM(v_existing_dep_asset)) IS DISTINCT FROM v_norm_asset)
           OR (v_existing_dep_token_symbol IS NOT NULL AND UPPER(BTRIM(v_existing_dep_token_symbol)) IS DISTINCT FROM v_norm_asset)
           OR (v_existing_onchain_asset_symbol IS NOT NULL AND UPPER(BTRIM(v_existing_onchain_asset_symbol)) IS DISTINCT FROM v_norm_asset) THEN
            RETURN jsonb_build_object('success', false, 'code', 'ASSET_MISMATCH', 'message', 'Deposit asset symbol cannot be modified');
        END IF;

        -- Immutable Required Confirmations Check
        IF v_existing_onchain_req_confirmations IS NOT NULL 
           AND v_existing_onchain_req_confirmations IS DISTINCT FROM v_required_confirmations THEN
            RETURN jsonb_build_object('success', false, 'code', 'REQUIRED_CONFIRMATIONS_MISMATCH', 'message', 'Required confirmations threshold mismatch');
        END IF;

        -- Monotonic Confirmations & Block Number
        v_effective_confirmations := GREATEST(COALESCE(v_existing_onchain_confirmations, 0), p_confirmations);
        
        IF v_existing_dep_block_number IS NOT NULL THEN
            v_effective_block_number := GREATEST(v_existing_dep_block_number, COALESCE(p_block_number, 0));
        ELSE
            v_effective_block_number := p_block_number;
        END IF;
    ELSE
        -- Brand new deposit: assign fresh UUIDs
        v_effective_confirmations := p_confirmations;
        v_effective_block_number := p_block_number;
        v_deposit_id := gen_random_uuid();
        v_onchain_id := gen_random_uuid();
    END IF;

    -- ------------------------------------------------------------------------
    -- 7. CONFIRMATION DETERMINATION & DEPOSIT LEDGER IDEMPOTENCY (NO LIMIT 1)
    -- ------------------------------------------------------------------------
    v_is_confirmed := (v_effective_confirmations >= v_required_confirmations);

    SELECT COUNT(*), MIN(id)
    INTO v_ledger_count, v_matched_ledger_id
    FROM public.ledger_entries
    WHERE type = 'deposit'
      AND reference_id = v_deposit_id::text;

    -- State Machine Transitions
    IF v_has_existing_deposit AND v_has_existing_onchain THEN
        -- Case A: Existing deposit is already completed/confirmed
        IF v_existing_dep_status IN ('completed', 'confirmed') 
           OR v_existing_onchain_status = 'CONFIRMED' THEN

            IF v_existing_dep_status NOT IN ('completed', 'confirmed') 
               OR v_existing_onchain_status <> 'CONFIRMED' THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Discrepancy in existing completed deposit state');
            END IF;

            IF v_ledger_count <> 1 THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Expected exactly 1 deposit ledger entry for credited deposit, found ' || v_ledger_count::text);
            END IF;

            SELECT user_id, type, amount
            INTO v_existing_ledger_user_id, v_existing_ledger_type, v_existing_ledger_amount
            FROM public.ledger_entries
            WHERE id = v_matched_ledger_id;

            IF v_existing_ledger_user_id IS DISTINCT FROM v_user_id
               OR v_existing_ledger_type IS DISTINCT FROM 'deposit'
               OR v_existing_ledger_amount IS DISTINCT FROM p_amount THEN
                RETURN jsonb_build_object('success', false, 'code', 'LEDGER_RECORD_MISMATCH', 'message', 'Existing ledger entry details mismatch deposit details');
            END IF;

            -- Update confirmations/block numbers monotonically if increased
            IF v_effective_confirmations > COALESCE(v_existing_onchain_confirmations, 0) THEN
                UPDATE public.onchain_deposits
                SET confirmations = v_effective_confirmations,
                    updated_at = NOW()
                WHERE id = v_onchain_id;

                IF v_effective_block_number IS NOT NULL AND v_effective_block_number IS DISTINCT FROM v_existing_dep_block_number THEN
                    UPDATE public.deposits
                    SET block_number = v_effective_block_number
                    WHERE id = v_deposit_id;
                END IF;
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'ALREADY_CREDITED',
                'deposit_id', v_deposit_id,
                'onchain_id', v_onchain_id,
                'user_id', v_user_id,
                'confirmations', v_effective_confirmations,
                'required_confirmations', v_required_confirmations,
                'message', 'Deposit already processed and credited'
            );
        END IF;

        -- Case B: Existing deposit is PENDING and remains PENDING
        IF NOT v_is_confirmed THEN
            IF v_existing_dep_status <> 'pending' OR v_existing_onchain_status <> 'PENDING' THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Invalid state for unconfirmed existing deposit');
            END IF;

            IF v_ledger_count > 0 THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Deposit ledger entry found for uncredited pending deposit');
            END IF;

            -- Update confirmations if increased
            IF v_effective_confirmations > COALESCE(v_existing_onchain_confirmations, 0) THEN
                UPDATE public.onchain_deposits
                SET confirmations = v_effective_confirmations,
                    updated_at = NOW()
                WHERE id = v_onchain_id;

                IF v_effective_block_number IS NOT NULL AND v_effective_block_number IS DISTINCT FROM v_existing_dep_block_number THEN
                    UPDATE public.deposits
                    SET block_number = v_effective_block_number
                    WHERE id = v_deposit_id;
                END IF;
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'status', 'PENDING',
                'deposit_id', v_deposit_id,
                'onchain_id', v_onchain_id,
                'confirmations', v_effective_confirmations,
                'required_confirmations', v_required_confirmations,
                'message', 'Deposit pending confirmation threshold'
            );
        END IF;

        -- Case C: Existing deposit transitions from PENDING to CONFIRMED
        IF v_existing_dep_status <> 'pending' OR v_existing_onchain_status <> 'PENDING' THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Cannot transition non-pending deposit to confirmed');
        END IF;

        IF v_ledger_count > 0 THEN
            RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Deposit ledger entry already exists for pending transition');
        END IF;
    ELSE
        -- Case D: Brand new deposit that is NOT YET confirmed
        IF NOT v_is_confirmed THEN
            IF v_ledger_count > 0 THEN
                RETURN jsonb_build_object('success', false, 'code', 'DEPOSIT_STATE_INCONSISTENT', 'message', 'Deposit ledger entry exists for new unconfirmed deposit');
            END IF;

            INSERT INTO public.deposits (
                id, user_id, chain, token_symbol, tx_hash, amount,
                from_address, to_address, status, block_number,
                created_at, asset, output_index
            ) VALUES (
                v_deposit_id, v_user_id, v_norm_network, v_norm_asset, p_tx_hash, p_amount,
                v_canonical_from, p_destination_address, 'pending', v_effective_block_number,
                NOW(), v_norm_asset, p_output_index
            );

            INSERT INTO public.onchain_deposits (
                id, user_id, network, asset_symbol,
                address, to_address, tx_hash,
                output_index, amount, status, confirmations,
                required_confirmations, created_at, updated_at,
                asset, network_code, asset_code
            ) VALUES (
                v_onchain_id, v_user_id, v_norm_network, v_norm_asset,
                p_destination_address, p_destination_address, p_tx_hash,
                p_output_index, p_amount, 'PENDING', v_effective_confirmations,
                v_required_confirmations, NOW(), NOW(),
                v_norm_asset, v_norm_network, v_norm_asset
            );

            RETURN jsonb_build_object(
                'success', true,
                'status', 'PENDING',
                'deposit_id', v_deposit_id,
                'onchain_id', v_onchain_id,
                'confirmations', v_effective_confirmations,
                'required_confirmations', v_required_confirmations,
                'message', 'New deposit recorded as pending'
            );
        END IF;
        
        -- Case E: Brand new deposit that IS immediately confirmed -> proceed to atomic credit
    END IF;

    -- ------------------------------------------------------------------------
    -- 8. CONCURRENCY HARDENED wallet_assets ADVISORY LOCK & FOR UPDATE MUTATION
    -- ------------------------------------------------------------------------
    -- Acquire deterministic advisory lock for (user_id, asset_symbol) pair
    PERFORM pg_advisory_xact_lock(hashtext('wallet_asset:' || v_user_id::text || ':' || v_norm_asset));

    -- Assert cardinality strictly equals 1
    SELECT COUNT(*), MIN(id)
    INTO v_asset_count, v_asset_id
    FROM public.wallet_assets
    WHERE user_id = v_user_id
      AND asset_symbol = v_norm_asset;

    IF v_asset_count = 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_ASSET_NOT_FOUND',
            'message', 'Wallet asset row for ' || v_norm_asset || ' not initialized for user'
        );
    ELSIF v_asset_count > 1 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'WALLET_ASSET_CARDINALITY_CONFLICT',
            'message', 'Multiple wallet asset records found for user and asset ' || v_norm_asset
        );
    END IF;

    -- Retrieve authoritative balance under strict row lock
    SELECT balance INTO v_prev_balance
    FROM public.wallet_assets
    WHERE id = v_asset_id
    FOR UPDATE;

    IF v_prev_balance IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_WALLET_BALANCE',
            'message', 'Wallet balance is NULL for asset ' || v_norm_asset
        );
    END IF;

    v_new_balance := v_prev_balance + p_amount;

    IF v_new_balance IS NULL OR (v_new_balance - v_prev_balance) IS DISTINCT FROM p_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'BALANCE_MUTATION_FAILED',
            'message', 'Mathematical invariant violation during balance credit'
        );
    END IF;

    -- Update balance strictly on wallet_assets.id (preserves in_escrow/locked/reserved balances)
    UPDATE public.wallet_assets
    SET balance = v_new_balance,
        updated_at = NOW()
    WHERE id = v_asset_id;

    IF v_has_existing_deposit THEN
        UPDATE public.deposits
        SET status = 'completed',
            block_number = COALESCE(v_effective_block_number, block_number)
        WHERE id = v_deposit_id;
    ELSE
        INSERT INTO public.deposits (
            id, user_id, chain, token_symbol, tx_hash, amount,
            from_address, to_address, status, block_number,
            created_at, asset, output_index
        ) VALUES (
            v_deposit_id, v_user_id, v_norm_network, v_norm_asset, p_tx_hash, p_amount,
            v_canonical_from, p_destination_address, 'completed', v_effective_block_number,
            NOW(), v_norm_asset, p_output_index
        );
    END IF;

    IF v_has_existing_onchain THEN
        UPDATE public.onchain_deposits
        SET status = 'CONFIRMED',
            confirmations = v_effective_confirmations,
            updated_at = NOW()
        WHERE id = v_onchain_id;
    ELSE
        INSERT INTO public.onchain_deposits (
            id, user_id, network, asset_symbol,
            address, to_address, tx_hash,
            output_index, amount, status, confirmations,
            required_confirmations, created_at, updated_at,
            asset, network_code, asset_code
        ) VALUES (
            v_onchain_id, v_user_id, v_norm_network, v_norm_asset,
            p_destination_address, p_destination_address, p_tx_hash,
            p_output_index, p_amount, 'CONFIRMED', v_effective_confirmations,
            v_required_confirmations, NOW(), NOW(),
            v_norm_asset, v_norm_network, v_norm_asset
        );
    END IF;

    -- Write single authoritative ledger entry using ONLY live schema columns
    v_ledger_id := gen_random_uuid();

    INSERT INTO public.ledger_entries (
        id,
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
        v_ledger_id,
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
        'confirmed'
    );

    RETURN jsonb_build_object(
        'success', true,
        'status', 'CONFIRMED',
        'deposit_id', v_deposit_id,
        'onchain_id', v_onchain_id,
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

-- ----------------------------------------------------------------------------
-- STEP 4: PRECHECK & VERIFICATION OF USER ROUTE INTEGRITY
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_target_user UUID := '8925fed8-c8bf-44a3-97fa-bd806aade05a';
    v_uda_count INT;
    v_wallets_count INT;
BEGIN
    SELECT COUNT(*) INTO v_uda_count
    FROM public.user_deposit_addresses
    WHERE user_id = v_target_user;

    SELECT COUNT(*) INTO v_wallets_count
    FROM public.wallets
    WHERE user_id = v_target_user;

    IF v_uda_count < 3 THEN
        RAISE EXCEPTION 'PRECHECK FAILED: Target user expects at least 3 deposit address routes (found %)', v_uda_count;
    END IF;

    IF v_wallets_count < 4 THEN
        RAISE EXCEPTION 'PRECHECK FAILED: Target user expects 4 wallet chain records (BTC, EVM, LTC, TRON) (found %)', v_wallets_count;
    END IF;
END $$;

-- ----------------------------------------------------------------------------
-- STEP 5: FINAL TRANSACTION VERIFICATION ASSERTIONS
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_target_user UUID := '8925fed8-c8bf-44a3-97fa-bd806aade05a';
    v_btc_wallet_count INT;
    v_evm_wallet_count INT;
    v_ltc_wallet_count INT;
    v_tron_wallet_count INT;
BEGIN
    SELECT COUNT(*) INTO v_btc_wallet_count FROM public.wallets WHERE user_id = v_target_user AND chain = 'BTC' AND funding_status = 'active';
    SELECT COUNT(*) INTO v_evm_wallet_count FROM public.wallets WHERE user_id = v_target_user AND chain = 'EVM' AND funding_status = 'active';
    SELECT COUNT(*) INTO v_ltc_wallet_count FROM public.wallets WHERE user_id = v_target_user AND chain = 'LTC' AND funding_status = 'active';
    SELECT COUNT(*) INTO v_tron_wallet_count FROM public.wallets WHERE user_id = v_target_user AND chain = 'TRON' AND funding_status = 'active';

    IF v_btc_wallet_count <> 1 OR v_evm_wallet_count <> 1 OR v_ltc_wallet_count <> 1 OR v_tron_wallet_count <> 1 THEN
        RAISE EXCEPTION 'MIGRATION ASSERTION FAILED: Target user active wallets missing or ambiguous (BTC=%, EVM=%, LTC=%, TRON=%)',
            v_btc_wallet_count, v_evm_wallet_count, v_ltc_wallet_count, v_tron_wallet_count;
    END IF;
END $$;

COMMIT;
