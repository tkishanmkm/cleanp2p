-- ==============================================================================
-- Supabase Migration: 20261006020000_canonical_kyc_tier_business_rules.sql
-- Description: PART 2D — Canonical KYC Tier 1 / Tier 2 Business Rules Enforcement
--              
--              TIER 1 (Unverified / No KYC):
--                - DEPOSIT: ALLOW (Unlimited)
--                - RECEIVE TRANSFER: ALLOW (Unlimited)
--                - BUY: ALLOW, cumulative BUY volume limited to USD $1,000.00
--                - SELL: BLOCK (Requires Tier 2)
--                - TRANSFER OUT: BLOCK (Requires Tier 2)
--                - WITHDRAWAL: BLOCK (Requires Tier 2)
--
--              TIER 2 (KYC Approved / Verified):
--                - DEPOSIT, RECEIVE TRANSFER, BUY, SELL, TRANSFER OUT: ALLOW (Unlimited)
--                - WITHDRAWAL: ALLOW (Subject to standard security holds/limits)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Ensure Immutable Columns & Immutability Trigger on public.trades & public.transfers
-- ------------------------------------------------------------------------------
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS usd_value_at_trade NUMERIC(18,2);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_idempotency_key 
    ON public.trades (idempotency_key) 
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.transfers ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfers_sender_idempotency
    ON public.transfers (sender_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE OR REPLACE FUNCTION public.prevent_usd_value_at_trade_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.usd_value_at_trade IS DISTINCT FROM OLD.usd_value_at_trade THEN
        RAISE EXCEPTION 'Immutable field error: usd_value_at_trade cannot be modified after trade creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
        RAISE EXCEPTION 'Immutable field error: idempotency_key cannot be modified after trade creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
        RAISE EXCEPTION 'Immutable field error: request_fingerprint cannot be modified after trade creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_usd_value_at_trade_update ON public.trades;
CREATE TRIGGER trg_prevent_usd_value_at_trade_update
    BEFORE UPDATE ON public.trades
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_usd_value_at_trade_update();

CREATE OR REPLACE FUNCTION public.prevent_transfer_immutability_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
        RAISE EXCEPTION 'Immutable field error: sender_id cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.recipient_id IS DISTINCT FROM OLD.recipient_id THEN
        RAISE EXCEPTION 'Immutable field error: recipient_id cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
        RAISE EXCEPTION 'Immutable field error: amount cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.fee_amount IS DISTINCT FROM OLD.fee_amount THEN
        RAISE EXCEPTION 'Immutable field error: fee_amount cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.crypto IS DISTINCT FROM OLD.crypto THEN
        RAISE EXCEPTION 'Immutable field error: crypto cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.asset_symbol IS DISTINCT FROM OLD.asset_symbol THEN
        RAISE EXCEPTION 'Immutable field error: asset_symbol cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
        RAISE EXCEPTION 'Immutable field error: idempotency_key cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    IF NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint THEN
        RAISE EXCEPTION 'Immutable field error: request_fingerprint cannot be modified after transfer creation.'
            USING ERRCODE = 'P0001', DETAIL = 'IMMUTABLE_FIELD_VIOLATION';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_transfer_immutability_update ON public.transfers;
CREATE TRIGGER trg_prevent_transfer_immutability_update
    BEFORE UPDATE ON public.transfers
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_transfer_immutability_update();

-- Drop Legacy/Obsolete General Trading Limit Functions
DROP FUNCTION IF EXISTS public.check_user_kyc_trading_limit(UUID, NUMERIC);
DROP FUNCTION IF EXISTS public.check_user_kyc_trading_limit(UUID);

-- ------------------------------------------------------------------------------
-- 2. Helper Function: public.get_user_kyc_tier(UUID)
-- Returns 2 if user is verified/approved Tier 2; returns 1 if unverified Tier 1.
-- Strictly checks current active kyc_status ('approved' or 'verified').
-- Internal helper executable strictly by system RPCs, service_role, and postgres.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_kyc_tier(p_user_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_kyc_status TEXT := 'none';
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 1;
    END IF;

    SELECT LOWER(COALESCE(kyc_status, 'none'))
    INTO v_kyc_status
    FROM public.profiles
    WHERE id = p_user_id;

    -- Strict Tier 2 definition: current active kyc_status must be explicitly approved or verified
    IF v_kyc_status IN ('approved', 'verified') THEN
        RETURN 2;
    ELSE
        RETURN 1;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_kyc_tier(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_kyc_tier(UUID) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 3. Helper Function: public.get_user_cumulative_buy_volume(UUID)
-- Internal SECURITY DEFINER helper function.
-- Computes lifetime cumulative BUY volume in USD for non-cancelled/non-expired BUY trades.
-- Fails closed if canonical USD valuation cannot be established.
-- Executable strictly by system RPCs, service_role, and postgres.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_cumulative_buy_volume(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total NUMERIC := 0;
    v_rec RECORD;
    v_usd_price NUMERIC;
    v_trade_usd NUMERIC;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_rec IN 
        SELECT 
            t.id,
            t.usd_value_at_trade,
            UPPER(COALESCE(t.fiat_currency, 'USD')) AS fiat_currency,
            t.fiat_amount,
            UPPER(COALESCE(t.crypto, t.asset, t.crypto_currency, t.asset_code, 'USDT')) AS crypto_asset,
            COALESCE(t.crypto_amount, t.amount, 0) AS crypto_amount
        FROM public.trades t
        WHERE (t.buyer_id = p_user_id::TEXT OR t.buyer_id = p_user_id::VARCHAR)
          AND LOWER(COALESCE(t.status::TEXT, '')) NOT IN ('cancelled', 'canceled', 'expired', 'failed', 'rejected')
    LOOP
        v_trade_usd := 0;

        -- CASE 1: Immutable execution-time snapshot persisted on trade creation
        IF v_rec.usd_value_at_trade IS NOT NULL AND v_rec.usd_value_at_trade >= 0 THEN
            v_trade_usd := v_rec.usd_value_at_trade;

        -- CASE 2: Legacy trade denominated directly in USD fiat
        ELSIF v_rec.fiat_currency = 'USD' AND v_rec.fiat_amount IS NOT NULL AND v_rec.fiat_amount > 0 THEN
            v_trade_usd := v_rec.fiat_amount;

        -- CASE 3: Legacy USDT trade (Canonical platform rule: 1 USDT = $1.00 USD)
        ELSIF v_rec.crypto_asset = 'USDT' AND v_rec.crypto_amount IS NOT NULL AND v_rec.crypto_amount > 0 THEN
            v_trade_usd := v_rec.crypto_amount;

        -- CASE 4: Legacy non-USD fiat + non-USDT crypto trade without immutable snapshot -> FAIL CLOSED
        ELSE
            RAISE EXCEPTION 'Unable to determine historical USD value for BUY limit calculation on trade % (asset %, fiat %). Complete KYC Tier 2 verification.',
                v_rec.id, v_rec.crypto_asset, v_rec.fiat_currency
                USING ERRCODE = 'P0001', DETAIL = 'HISTORICAL_USD_VALUATION_UNAVAILABLE';
        END IF;

        v_total := v_total + v_trade_usd;
    END LOOP;

    RETURN ROUND(v_total, 2);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_cumulative_buy_volume(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_cumulative_buy_volume(UUID) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 4. Helper Function: public.get_user_remaining_buy_allowance(UUID)
-- Internal SECURITY DEFINER helper function.
-- Returns NULL for Tier 2 (unlimited), or remaining USD allowance (max $1,000) for Tier 1.
-- Executable strictly by system RPCs, service_role, and postgres.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_remaining_buy_allowance(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tier INTEGER;
    v_cum_buys NUMERIC;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 0;
    END IF;

    v_tier := public.get_user_kyc_tier(p_user_id);
    IF v_tier = 2 THEN
        RETURN NULL; -- Unlimited
    END IF;

    v_cum_buys := public.get_user_cumulative_buy_volume(p_user_id);
    RETURN GREATEST(0.00, ROUND(1000.00 - v_cum_buys, 2));
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_remaining_buy_allowance(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_remaining_buy_allowance(UUID) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 4.1 Self-Service RPC: public.get_my_kyc_info()
-- Allows logged-in authenticated users to inspect their own KYC tier, lifetime buy volume,
-- remaining USD allowance, and permission flags securely without exposing internal helpers.
-- Catches historical valuation exceptions gracefully so settings UI never crashes.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_kyc_info()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_tier INTEGER;
    v_cum_buys NUMERIC := 0;
    v_allowance NUMERIC := NULL;
    v_valuation_status TEXT := 'OK';
BEGIN
    IF v_auth_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_tier := public.get_user_kyc_tier(v_auth_uid);
    IF v_tier = 1 THEN
        BEGIN
            v_cum_buys := public.get_user_cumulative_buy_volume(v_auth_uid);
            v_allowance := GREATEST(0.00, ROUND(1000.00 - v_cum_buys, 2));
        EXCEPTION WHEN SQLSTATE 'P0001' THEN
            GET STACKED DIAGNOSTICS v_valuation_status = PG_EXCEPTION_DETAIL;
            IF v_valuation_status = 'HISTORICAL_USD_VALUATION_UNAVAILABLE' THEN
                v_cum_buys := NULL;
                v_allowance := NULL;
                v_valuation_status := 'NEEDS_VERIFICATION';
            ELSE
                RAISE; -- Re-raise unrelated P0001 exceptions
            END IF;
        END;
    END IF;

    RETURN jsonb_build_object(
        'user_id', v_auth_uid,
        'tier', v_tier,
        'is_tier_2', (v_tier = 2),
        'cumulative_buy_volume_usd', v_cum_buys,
        'remaining_buy_allowance_usd', v_allowance,
        'valuation_status', v_valuation_status,
        'can_deposit', true,
        'can_receive_transfer', true,
        'can_buy', CASE WHEN v_tier = 2 THEN true ELSE (COALESCE(v_allowance, 0) > 0) END,
        'can_sell', (v_tier = 2),
        'can_transfer_out', (v_tier = 2),
        'can_withdraw', (v_tier = 2)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_kyc_info() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_kyc_info() TO authenticated, service_role, postgres;

-- ------------------------------------------------------------------------------
-- 5. Trade RPC definition is intentionally deferred to the canonical public.ads migration.
-- This migration predates the public.ads identifier resolution and references the removed
-- public.p2p_ads relation. Keep the KYC helper rules above, but do not install an obsolete
-- trade RPC here; 20261007010000_canonical_public_ads_identifier_resolution.sql installs
-- the final implementation with KYC, emergency-freeze, and idempotency checks.
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT);

-- 6. Canonical execute_internal_transfer WITH SENDER TIER 2 KYC ENFORCEMENT
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
    p_sender_id UUID,
    p_recipient_username TEXT,
    p_asset TEXT,
    p_gross_amount NUMERIC,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    v_sender_frozen BOOLEAN := FALSE;
    v_recipient_frozen BOOLEAN := FALSE;

    -- Sender KYC Tier
    v_sender_tier INTEGER := 1;

    -- Canonical Platform Controls (system_settings)
    v_sys_emergency_val JSONB := NULL;
    v_sys_prevent_transfers_val JSONB := NULL;
    v_sys_emergency_mode BOOLEAN := NULL;
    v_sys_prevent_transfers BOOLEAN := NULL;
    
    -- Financial Variables
    v_recipient_amount NUMERIC(36, 18);
    v_fee_amount NUMERIC(36, 18);
    v_total_deduction NUMERIC(36, 18);
    v_fee_rate NUMERIC(10, 6) := 0.015; -- 1.5% platform fee
    v_request_fingerprint TEXT := NULL;
    
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
    -- 1. Input Validation & Strict Idempotency Key Validation
    IF p_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ID is required', 'code', 'SENDER_ID_REQUIRED');
    END IF;

    IF auth.role() <> 'service_role' AND auth.uid() IS NOT NULL AND auth.uid() <> p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Sender identity mismatch', 'code', 'UNAUTHORIZED');
    END IF;

    IF v_clean_idempotency IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Idempotency key is required for transfer execution', 'code', 'IDEMPOTENCY_KEY_REQUIRED');
    END IF;

    -- 1.1 Acquire Transaction-Scoped Advisory Lock on Transfer Idempotency
    PERFORM pg_advisory_xact_lock(hashtextextended('execute_internal_transfer:' || p_sender_id::TEXT || ':' || v_clean_idempotency, 0));
    
    -- 1.2 Early Idempotency Lookup & Replay
    SELECT * INTO v_existing_transfer
    FROM public.transfers
    WHERE sender_id = p_sender_id 
      AND idempotency_key = v_clean_idempotency
    LIMIT 1;

    IF v_existing_transfer.id IS NOT NULL THEN
        -- 1.2.1 Strict Request Replay Validation: All required transfer parameters must be present in current request
        IF v_clean_username = '' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Idempotency request incomplete: Recipient username is required for transfer replay verification.',
                'code', 'IDEMPOTENCY_REQUEST_INCOMPLETE'
            );
        END IF;

        IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Idempotency request incomplete: Transfer gross amount is required and must be strictly positive for transfer replay verification.',
                'code', 'IDEMPOTENCY_REQUEST_INCOMPLETE'
            );
        END IF;

        IF v_asset_clean = '' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Idempotency request incomplete: Transfer asset is required for transfer replay verification.',
                'code', 'IDEMPOTENCY_REQUEST_INCOMPLETE'
            );
        END IF;

        -- 1.2.2 Resolve candidate recipient ID from CURRENT request to guarantee stable UUID identity comparison
        v_recipient_id := NULL;
        SELECT id INTO v_recipient_id FROM public.profiles WHERE LOWER(username) = v_clean_username LIMIT 1;
        IF v_recipient_id IS NULL AND p_recipient_username ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            SELECT id INTO v_recipient_id FROM public.profiles WHERE id = p_recipient_username::UUID LIMIT 1;
        END IF;
        IF v_recipient_id IS NULL THEN
            SELECT uda.user_id INTO v_recipient_id FROM public.deposit_addresses uda WHERE uda.address = p_recipient_username LIMIT 1;
        END IF;

        IF v_recipient_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Idempotency request incomplete: Recipient could not be resolved from current request.',
                'code', 'IDEMPOTENCY_REQUEST_INCOMPLETE'
            );
        END IF;

        -- 1.2.3 Candidate Fingerprint Calculation (Computed strictly from current request parameters)
        v_request_fingerprint := encode(
            sha256(
                (p_sender_id::TEXT || ':' || 
                 v_recipient_id::TEXT || ':' || 
                 v_asset_clean || ':' || 
                 ROUND(p_gross_amount, 8)::TEXT)::bytea
            ),
            'hex'
        );

        IF v_existing_transfer.request_fingerprint IS NOT NULL THEN
            IF v_existing_transfer.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Idempotency key reuse conflict: Key was previously used for a transfer with different parameters.',
                    'code', 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
                );
            END IF;
        END IF;

        -- 1.2.4 Request Consistency Validation: Ensure asset, gross amount, and recipient UUID match
        IF UPPER(v_existing_transfer.crypto) IS DISTINCT FROM v_asset_clean
           OR ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) IS DISTINCT FROM ROUND(p_gross_amount, 8)
           OR v_existing_transfer.recipient_id IS DISTINCT FROM v_recipient_id THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'Idempotency key reuse conflict: Key was previously used for a transfer with different parameters.',
                'code', 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
            );
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'transfer_id', v_existing_transfer.id,
            'public_id', v_existing_transfer.public_id,
            'sender_id', v_existing_transfer.sender_id,
            'recipient_id', v_existing_transfer.recipient_id,
            'recipient_username', v_existing_transfer.recipient_username,
            'asset', v_existing_transfer.crypto,
            'gross_amount', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0),
            'fee_amount', COALESCE(v_existing_transfer.fee_amount, 0),
            'status', v_existing_transfer.status,
            'message', 'Transfer already processed (idempotent replay)'
        );
    END IF;

    IF v_clean_username = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient username is required');
    END IF;

    IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transfer amount must be strictly greater than zero');
    END IF;

    IF v_asset_clean NOT IN ('USDT', 'BTC', 'ETH', 'LTC') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unsupported asset for transfer: ' || v_asset_clean || '. Supported: USDT, BTC, ETH, LTC'
        );
    END IF;

    -- 1.1 Platform Controls
    SELECT value INTO v_sys_emergency_val FROM public.system_settings WHERE key = 'emergency_mode';
    SELECT value INTO v_sys_prevent_transfers_val FROM public.system_settings WHERE key = 'prevent_transfers';

    IF v_sys_emergency_val IS NULL OR v_sys_prevent_transfers_val IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Platform emergency control state is unavailable. Transfer rejected for security reasons.',
            'code', 'PLATFORM_CONTROL_STATE_UNAVAILABLE'
        );
    END IF;

    IF jsonb_typeof(v_sys_emergency_val) = 'boolean' THEN
        v_sys_emergency_mode := (v_sys_emergency_val)::boolean;
    ELSIF jsonb_typeof(v_sys_emergency_val) = 'string' THEN
        v_sys_emergency_mode := (LOWER(v_sys_emergency_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Invalid platform control value for emergency_mode.');
    END IF;

    IF jsonb_typeof(v_sys_prevent_transfers_val) = 'boolean' THEN
        v_sys_prevent_transfers := (v_sys_prevent_transfers_val)::boolean;
    ELSIF jsonb_typeof(v_sys_prevent_transfers_val) = 'string' THEN
        v_sys_prevent_transfers := (LOWER(v_sys_prevent_transfers_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'Invalid platform control value for prevent_transfers.');
    END IF;

    IF v_sys_emergency_mode THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Master Emergency Mode is active. Internal transfers are temporarily suspended.',
            'code', 'PLATFORM_EMERGENCY_MODE'
        );
    END IF;

    IF v_sys_prevent_transfers THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Internal transfers are temporarily disabled by the administrator.',
            'code', 'TRANSFERS_DISABLED'
        );
    END IF;

    -- 1.2 Pending Withdrawal Approval Lockout
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON n.oid = p.pronamespace 
        WHERE n.nspname = 'public' AND p.proname = 'has_pending_withdrawal_approval'
    ) THEN
        IF public.has_pending_withdrawal_approval(p_sender_id) THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'WITHDRAWAL_APPROVAL_PENDING: You have a pending withdrawal awaiting administrator approval. Sending internal transfers is restricted until this withdrawal is reviewed.',
                'code', 'WITHDRAWAL_APPROVAL_PENDING'
            );
        END IF;
    END IF;

    -- 2. Resolve Recipient
    SELECT id INTO v_recipient_id FROM public.profiles WHERE LOWER(username) = v_clean_username LIMIT 1;

    IF v_recipient_id IS NULL AND p_recipient_username ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_recipient_id FROM public.profiles WHERE id = p_recipient_username::UUID LIMIT 1;
    END IF;

    IF v_recipient_id IS NULL THEN
        SELECT uda.user_id INTO v_recipient_id
        FROM public.deposit_addresses uda
        WHERE uda.address = p_recipient_username
        LIMIT 1;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient user @' || p_recipient_username || ' not found on the platform');
    END IF;

    IF v_recipient_id = p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot transfer funds to yourself');
    END IF;

    -- 3. Deterministic Profile Locking (Smaller UUID first)
    IF p_sender_id < v_recipient_id THEN
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;
    ELSE
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    END IF;

    IF v_sender_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile not found');
    END IF;

    IF v_sender_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_sender_banned OR v_sender_restricted OR v_sender_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account is restricted or non-active. Transfers are blocked.');
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 3.1: SENDER KYC TIER 2 ENFORCEMENT
    -- Transfer OUT requires Tier 2 (KYC Verified). Tier 1 is BLOCKED.
    -- (Receiving transfer requires no KYC check and is allowed for Tier 1).
    -- =========================================================================
    v_sender_tier := public.get_user_kyc_tier(p_sender_id);
    IF v_sender_tier < 2 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'KYC verification is required to transfer funds out.',
            'code', 'KYC_REQUIRED'
        );
    END IF;

    IF v_recipient_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient profile not found');
    END IF;

    IF v_recipient_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot transfer: Recipient account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_recipient_banned OR v_recipient_restricted OR v_recipient_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot transfer: Recipient account is restricted or non-active on the platform.');
    END IF;

    -- 4. Financial Deductions & Balance Updates (Live wallet_assets Schema)
    v_total_deduction := ROUND(p_gross_amount, 8);
    v_fee_amount := ROUND(v_total_deduction * v_fee_rate, 8);
    v_recipient_amount := v_total_deduction - v_fee_amount;

    -- Lock Sender Wallet
    SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
    FROM public.wallet_assets
    WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
    FOR UPDATE;

    IF v_sender_wallet_asset_id IS NULL OR v_sender_bal < v_total_deduction THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient ' || v_asset_clean || ' balance for transfer.'
        );
    END IF;

    -- Lock/Ensure Recipient Wallet
    SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
    FROM public.wallet_assets
    WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
    FOR UPDATE;

    IF v_recipient_wallet_asset_id IS NULL THEN
        INSERT INTO public.wallet_assets (user_id, asset_symbol, balance, in_escrow, created_at, updated_at)
        VALUES (v_recipient_id, v_asset_clean, 0.0, 0.0, NOW(), NOW())
        RETURNING id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal;
    END IF;

    v_sender_bal_after := v_sender_bal - v_total_deduction;
    v_recipient_bal_after := v_recipient_bal + v_recipient_amount;

    UPDATE public.wallet_assets
    SET balance = v_sender_bal_after, updated_at = NOW()
    WHERE id = v_sender_wallet_asset_id;

    UPDATE public.wallet_assets
    SET balance = v_recipient_bal_after, updated_at = NOW()
    WHERE id = v_recipient_wallet_asset_id;

    v_transfer_id := gen_random_uuid();
    v_public_id := 'TRF' || UPPER(SUBSTRING(REPLACE(v_transfer_id::TEXT, '-', ''), 1, 9));

    -- 5. Calculate Canonical Transfer Request Fingerprint
    v_request_fingerprint := encode(
        sha256(
            (p_sender_id::TEXT || ':' || 
             v_recipient_id::TEXT || ':' || 
             v_asset_clean || ':' || 
             v_total_deduction::TEXT)::bytea
        ),
        'hex'
    );

    -- 6. Record Transfer in public.transfers (Live Schema Compatible)
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
        request_fingerprint,
        created_at
    ) VALUES (
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
        v_request_fingerprint,
        NOW()
    );

    -- 7. Double-Entry Ledger Entries (Live ledger_entries Schema)
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
    ) VALUES (
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
    ) VALUES (
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
            'recipient_amount', v_recipient_amount,
            'fee_amount', v_fee_amount,
            'fee_rate', v_fee_rate,
            'total_deduction', v_total_deduction,
            'direction', 'RECEIVED',
            'idempotency_key', v_clean_idempotency
        ),
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'public_id', v_public_id,
        'sender_id', p_sender_id,
        'recipient_id', v_recipient_id,
        'recipient_username', v_recipient_name,
        'asset', v_asset_clean,
        'gross_amount', v_total_deduction,
        'fee_amount', v_fee_amount,
        'net_amount', v_recipient_amount,
        'status', 'confirmed'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

COMMIT;
