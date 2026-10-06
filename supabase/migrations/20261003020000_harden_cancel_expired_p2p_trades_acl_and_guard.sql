-- Migration: 20261003020000_harden_cancel_expired_p2p_trades_acl_and_guard.sql
-- Target: Harden service-role guard and enforce strict ACL on public.cancel_expired_p2p_trades()
-- Security Fix: Removes unsafe (auth.uid() IS NULL) service-role check. Uses auth.role() = 'service_role'.
-- ACL Fix: Revokes EXECUTE from PUBLIC, anon, authenticated, and supabase_auth_admin.
-- Grants EXECUTE exclusively to service_role and postgres.

CREATE OR REPLACE FUNCTION public.cancel_expired_p2p_trades()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_auth_role TEXT := COALESCE(auth.role(), '');
    v_is_service_role BOOLEAN := FALSE;
    v_is_admin BOOLEAN := FALSE;
    v_rec RECORD;
    v_res JSONB;
    v_processed INTEGER := 0;
    v_skipped INTEGER := 0;
    v_failed INTEGER := 0;
BEGIN
    -- 1. Caller Privilege Guard: Backend Service Role & Postgres Admin Only
    v_is_service_role := (v_auth_role = 'service_role')
                      OR (current_setting('role', true) = 'service_role')
                      OR (SELECT current_user) IN ('postgres', 'service_role');

    IF v_auth_uid IS NOT NULL THEN
        v_is_admin := public.is_admin()
                   OR EXISTS (
                       SELECT 1 FROM auth.users
                       WHERE id = v_auth_uid
                         AND ((raw_user_meta_data->>'role') = 'admin' OR (raw_app_meta_data->>'role') = 'admin')
                   );
    END IF;

    IF NOT v_is_service_role AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: cancel_expired_p2p_trades is restricted strictly to backend system workers.';
    END IF;

    -- 2. Process Eligible Expired Trades with Transactional Isolation
    FOR v_rec IN 
        SELECT id FROM public.trades
        WHERE expires_at IS NOT NULL
          AND expires_at <= NOW()
          AND paid_at IS NULL
          AND marked_paid_at IS NULL
          AND LOWER(COALESCE(escrow_status::TEXT, '')) NOT IN ('paid', 'disputed', 'released', 'cancelled', 'expired')
          AND LOWER(COALESCE(status::TEXT, '')) NOT IN ('completed', 'released', 'cancelled', 'expired', 'paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute')
          AND NOT EXISTS (SELECT 1 FROM public.disputes WHERE trade_id = trades.id AND LOWER(status::TEXT) = 'open')
    LOOP
        BEGIN
            v_res := public.expire_p2p_trade(v_rec.id);
            IF (v_res->>'success')::BOOLEAN THEN
                v_processed := v_processed + 1;
            ELSE
                v_skipped := v_skipped + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'processed', v_processed,
        'skipped', v_skipped,
        'failed', v_failed
    );
END;
$$;

-- Strict ACL Privileges: Revoke from all non-system roles including supabase_auth_admin
REVOKE ALL ON FUNCTION public.cancel_expired_p2p_trades() FROM PUBLIC, anon, authenticated, supabase_auth_admin;

-- Grant EXECUTE exclusively to service_role and postgres
GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() TO service_role, postgres;
