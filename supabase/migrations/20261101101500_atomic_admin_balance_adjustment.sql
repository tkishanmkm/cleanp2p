-- Atomic, idempotent administrator spendable-balance adjustment.
-- Candidate only: replay on an isolated, schema-faithful PostgreSQL database,
-- run role/lock/rollback fixtures, and review the complete migration chain before
-- setting PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED=true in any deployment.
BEGIN;

-- Keep the deployed ledger vocabulary and add one explicit lower-case type.
ALTER TABLE public.ledger_entries
    DROP CONSTRAINT IF EXISTS ledger_entries_type_check;

ALTER TABLE public.ledger_entries
    ADD CONSTRAINT ledger_entries_type_check
    CHECK (type = ANY (ARRAY[
        'deposit'::text,
        'withdrawal'::text,
        'withdrawal_pending'::text,
        'transfer'::text,
        'fee'::text,
        'admin_adjustment'::text
    ]));

-- A request UUID is globally unique for this operation and is recorded on the
-- corresponding immutable ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_entries_admin_adjustment_request
    ON public.ledger_entries ((metadata ->> 'admin_adjustment_request_id'))
    WHERE type = 'admin_adjustment'
      AND metadata ? 'admin_adjustment_request_id';

-- This helper uses only schema-qualified references and is invoked from a
-- service-role-only SECURITY DEFINER wrapper.
ALTER FUNCTION public.check_is_admin(UUID, UUID) SET search_path = '';
ALTER FUNCTION public.sync_wallet_locked_reserved_balances() SET search_path = '';

CREATE OR REPLACE FUNCTION public.admin_adjust_balance_atomic(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_asset TEXT,
    p_action TEXT,
    p_amount NUMERIC,
    p_reason TEXT,
    p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_asset TEXT := UPPER(BTRIM(COALESCE(p_asset, '')));
    v_action TEXT := LOWER(BTRIM(COALESCE(p_action, '')));
    v_reason TEXT := NULLIF(BTRIM(p_reason), '');
    v_admin_email TEXT;
    v_target_exists BOOLEAN;
    v_existing public.ledger_entries%ROWTYPE;
    v_audit_exists BOOLEAN := FALSE;
    v_signed_amount NUMERIC;
    v_old_balance NUMERIC := 0;
    v_new_balance NUMERIC := 0;
    v_assets_balance NUMERIC;
    v_assets_locked NUMERIC;
    v_assets_reserved NUMERIC;
    v_assets_in_escrow NUMERIC;
    v_assets_in_withdrawal NUMERIC;
    v_assets_id UUID;
    v_user_wallet_id UUID;
    v_assets_match_count INTEGER := 0;
    v_user_match_count INTEGER := 0;
    v_user_balance NUMERIC;
    v_user_locked NUMERIC;
    v_user_reserved NUMERIC;
    v_assets_found BOOLEAN := FALSE;
    v_user_found BOOLEAN := FALSE;
    v_inserted_id UUID;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL THEN
        RAISE EXCEPTION 'Administrator, target user, and request ID are required.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.check_is_admin(p_admin_id, NULL) THEN
        RAISE EXCEPTION 'A full, active administrator account is required.'
            USING ERRCODE = '42501';
    END IF;

    IF v_asset NOT IN ('BTC', 'ETH', 'LTC', 'USDT', 'BNB', 'TRX') THEN
        RAISE EXCEPTION 'Unsupported wallet asset: %', v_asset
            USING ERRCODE = '22023';
    END IF;

    IF v_action NOT IN ('add', 'subtract') THEN
        RAISE EXCEPTION 'Action must be add or subtract.'
            USING ERRCODE = '22023';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0
       OR p_amount >= 'Infinity'::NUMERIC
       OR p_amount <> TRUNC(p_amount, 8) THEN
        RAISE EXCEPTION 'Amount must be finite, positive, and have at most 8 decimal places.'
            USING ERRCODE = '22023';
    END IF;

    IF v_reason IS NULL OR LENGTH(v_reason) < 10 OR LENGTH(v_reason) > 1000 THEN
        RAISE EXCEPTION 'A reason between 10 and 1000 characters is required.'
            USING ERRCODE = '22023';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_admin_email
      FROM auth.users AS u
     WHERE u.id = p_admin_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    SELECT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = p_target_user_id)
      INTO v_target_exists;
    IF NOT v_target_exists THEN
        RAISE EXCEPTION 'Target user does not exist.'
            USING ERRCODE = 'P0002';
    END IF;

    v_signed_amount := CASE WHEN v_action = 'add' THEN p_amount ELSE -p_amount END;

    -- Serialize retries by request UUID before looking for an existing ledger
    -- row. This also prevents two concurrent requests with the same UUID but
    -- different targets from racing the unique expression index.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('admin-balance-adjustment:' || p_request_id::TEXT, 0)
    );

    SELECT le.*
      INTO v_existing
      FROM public.ledger_entries AS le
     WHERE le.type = 'admin_adjustment'
       AND le.metadata ->> 'admin_adjustment_request_id' = p_request_id::TEXT
     LIMIT 1
     FOR UPDATE;

    IF FOUND THEN
        IF v_existing.user_id IS DISTINCT FROM p_target_user_id
           OR UPPER(COALESCE(v_existing.asset, v_existing.crypto, '')) <> v_asset
           OR v_existing.amount IS DISTINCT FROM v_signed_amount
           OR v_existing.metadata ->> 'admin_id' IS DISTINCT FROM p_admin_id::TEXT
           OR v_existing.metadata ->> 'reason' IS DISTINCT FROM v_reason
           OR v_existing.metadata ->> 'action' IS DISTINCT FROM v_action THEN
            RAISE EXCEPTION 'Idempotency key was already used for a different adjustment.'
                USING ERRCODE = '23505';
        END IF;

        SELECT EXISTS (
            SELECT 1
              FROM public.admin_audit_logs AS al
             WHERE al.action = 'ADMIN_BALANCE_ADJUSTED'
               AND al.admin_id = p_admin_id
               AND al.target_id = v_existing.id::TEXT
               AND al.target_user_id = p_target_user_id
               AND al.details ->> 'request_id' = p_request_id::TEXT
        )
        INTO v_audit_exists;

        IF NOT v_audit_exists THEN
            RAISE EXCEPTION 'The original balance adjustment is missing its mandatory audit evidence.'
                USING ERRCODE = 'P0001';
        END IF;

        RETURN JSONB_BUILD_OBJECT(
            'success', TRUE,
            'audit_logged', TRUE,
            'idempotent', TRUE,
            'request_id', p_request_id,
            'target_user_id', p_target_user_id,
            'asset', v_asset,
            'action', v_action,
            'amount', p_amount,
            'balance_after', v_existing.balance_after
        );
    END IF;

    -- wallet_assets is the authoritative spendable balance table. Lock it
    -- before its user_wallets fallback mirror; never update chain-address rows
    -- in public.wallets and never subtract escrow/withdrawal reservations here.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('wallet-balance:' || p_target_user_id::TEXT || ':' || v_asset, 0)
    );

    SELECT COUNT(*)
      INTO v_assets_match_count
      FROM public.wallet_assets AS wa
     WHERE wa.user_id = p_target_user_id
       AND UPPER(wa.asset_symbol) = v_asset;
    IF v_assets_match_count > 1 THEN
        RAISE EXCEPTION 'Multiple wallet asset rows match the requested asset; reconcile before adjustment.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT wa.id, wa.balance, wa.locked_balance, wa.reserved_balance,
           wa.in_escrow, wa.in_withdrawal
      INTO v_assets_id, v_assets_balance, v_assets_locked, v_assets_reserved,
           v_assets_in_escrow, v_assets_in_withdrawal
      FROM public.wallet_assets AS wa
     WHERE wa.user_id = p_target_user_id
       AND UPPER(wa.asset_symbol) = v_asset
     FOR UPDATE;
    v_assets_found := FOUND;

    SELECT COUNT(*)
      INTO v_user_match_count
      FROM public.user_wallets AS uw
     WHERE uw.user_id = p_target_user_id
       AND UPPER(uw.asset_symbol) = v_asset;
    IF v_user_match_count > 1 THEN
        RAISE EXCEPTION 'Multiple fallback wallet rows match the requested asset; reconcile before adjustment.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT uw.id, uw.balance, uw.locked_balance, uw.reserved_balance
      INTO v_user_wallet_id, v_user_balance, v_user_locked, v_user_reserved
      FROM public.user_wallets AS uw
     WHERE uw.user_id = p_target_user_id
       AND UPPER(uw.asset_symbol) = v_asset
     FOR UPDATE;
    v_user_found := FOUND;

    IF v_assets_found AND v_user_found
       AND COALESCE(v_assets_balance, 0) IS DISTINCT FROM COALESCE(v_user_balance, 0) THEN
        RAISE EXCEPTION 'Wallet balance mirrors disagree. Adjustment is blocked pending reconciliation.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_assets_found THEN
        v_old_balance := COALESCE(v_assets_balance, 0);
    ELSIF v_user_found THEN
        v_old_balance := COALESCE(v_user_balance, 0);
    ELSE
        v_old_balance := 0;
    END IF;

    IF v_action = 'subtract' AND v_old_balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient spendable balance. Locked, escrow, and withdrawal amounts cannot be debited.'
            USING ERRCODE = 'P0001';
    END IF;

    v_new_balance := v_old_balance + v_signed_amount;
    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Adjustment would create a negative spendable balance.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT v_assets_found THEN
        -- Mirror a legacy user_wallets row only when wallet_assets is absent.
        INSERT INTO public.wallet_assets (
            user_id, asset_symbol, balance, locked_balance, reserved_balance,
            in_escrow, in_withdrawal, created_at, updated_at
        )
        VALUES (
            p_target_user_id, v_asset, v_old_balance,
            COALESCE(v_user_locked, 0), COALESCE(v_user_reserved, v_user_locked, 0),
            0, 0, NOW(), NOW()
        )
        ON CONFLICT (user_id, asset_symbol) DO NOTHING;

        SELECT wa.id, wa.balance, wa.locked_balance, wa.reserved_balance,
               wa.in_escrow, wa.in_withdrawal
          INTO v_assets_id, v_assets_balance, v_assets_locked, v_assets_reserved,
               v_assets_in_escrow, v_assets_in_withdrawal
          FROM public.wallet_assets AS wa
         WHERE wa.user_id = p_target_user_id
           AND UPPER(wa.asset_symbol) = v_asset
         FOR UPDATE;

        IF NOT FOUND OR COALESCE(v_assets_balance, 0) IS DISTINCT FROM v_old_balance THEN
            RAISE EXCEPTION 'Wallet asset changed while the adjustment was being prepared. Retry after reconciliation.'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    IF NOT v_user_found THEN
        INSERT INTO public.user_wallets (
            user_id, asset_symbol, balance, locked_balance, reserved_balance,
            created_at, updated_at
        )
        VALUES (
            p_target_user_id, v_asset, v_old_balance,
            COALESCE(v_assets_locked, 0), COALESCE(v_assets_reserved, v_assets_locked, 0),
            NOW(), NOW()
        )
        ON CONFLICT (user_id, asset_symbol) DO NOTHING;

        SELECT uw.id, uw.balance, uw.locked_balance, uw.reserved_balance
          INTO v_user_wallet_id, v_user_balance, v_user_locked, v_user_reserved
          FROM public.user_wallets AS uw
         WHERE uw.user_id = p_target_user_id
           AND UPPER(uw.asset_symbol) = v_asset
         FOR UPDATE;

        IF NOT FOUND OR COALESCE(v_user_balance, 0) IS DISTINCT FROM v_old_balance THEN
            RAISE EXCEPTION 'Fallback wallet changed while the adjustment was being prepared. Retry after reconciliation.'
                USING ERRCODE = '40001';
        END IF;
    END IF;

    UPDATE public.wallet_assets
       SET balance = v_new_balance,
           updated_at = NOW()
     WHERE user_id = p_target_user_id
       AND UPPER(asset_symbol) = v_asset;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Canonical wallet asset update did not affect a row.'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.user_wallets
       SET balance = v_new_balance,
           updated_at = NOW()
     WHERE user_id = p_target_user_id
       AND UPPER(asset_symbol) = v_asset;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fallback wallet mirror update did not affect a row.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.ledger_entries (
        user_id, crypto, asset, amount, type, reference_id,
        balance_after, metadata, status, created_at
    )
    VALUES (
        p_target_user_id, v_asset, v_asset, v_signed_amount,
        'admin_adjustment', p_request_id::TEXT, v_new_balance,
        JSONB_BUILD_OBJECT(
            'action', v_action,
            'admin_id', p_admin_id,
            'admin_adjustment_request_id', p_request_id,
            'reason', v_reason,
            'old_balance', v_old_balance,
            'new_balance', v_new_balance
        ),
        'completed', NOW()
    )
    RETURNING id INTO v_inserted_id;

    -- The audit insert is mandatory and shares this database transaction with
    -- both wallet updates and the immutable ledger insert.
    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    )
    VALUES (
        p_admin_id,
        v_admin_email,
        'ADMIN_BALANCE_ADJUSTED',
        v_inserted_id::TEXT,
        p_target_user_id,
        JSONB_BUILD_OBJECT(
            'request_id', p_request_id,
            'asset', v_asset,
            'action', v_action,
            'amount', p_amount,
            'old_balance', v_old_balance,
            'new_balance', v_new_balance,
            'reason', v_reason
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'audit_logged', TRUE,
        'idempotent', FALSE,
        'request_id', p_request_id,
        'ledger_entry_id', v_inserted_id,
        'target_user_id', p_target_user_id,
        'asset', v_asset,
        'action', v_action,
        'amount', p_amount,
        'old_balance', v_old_balance,
        'new_balance', v_new_balance
    );
END;
$function$;

ALTER FUNCTION public.admin_adjust_balance_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, UUID)
    OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_adjust_balance_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance_atomic(UUID, UUID, TEXT, TEXT, NUMERIC, TEXT, UUID)
    TO service_role, postgres;

COMMIT;
