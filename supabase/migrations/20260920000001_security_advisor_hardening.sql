-- ==============================================================================
-- 20260920000001_security_advisor_hardening.sql
-- Exactly aligned to existing PostgreSQL tables and columns.
-- Fixes:
-- 1. admin_financial_overview SECURITY DEFINER view (Error 0010)
-- 2. sweep_logs & sweep_queue RLS policies (Info 0008)
-- 3. trade_attachments RLS policy lockdown (Warn 0024)
-- 4. search_path hardening on all functions (Warn 0011)
-- 5. Revoke anon/public execution from sensitive RPCs (Warn 0028 & 0029)
-- ==============================================================================

-- 1. Recreate admin_financial_overview VIEW with security_invoker = true
-- Exactly matching table schemas (user_wallets, sweep_logs, withdrawals, escrow_ledger)
DROP VIEW IF EXISTS public.admin_financial_overview CASCADE;

CREATE OR REPLACE VIEW public.admin_financial_overview
WITH (security_invoker = true)
AS
SELECT 
    COALESCE((SELECT SUM(COALESCE(balance, 0) + COALESCE(locked_balance, 0)) FROM public.user_wallets WHERE UPPER(asset_symbol::text) = 'USDT'), 0)::NUMERIC AS total_user_usdt_balance,
    COALESCE((SELECT SUM(COALESCE(balance, 0) + COALESCE(locked_balance, 0)) FROM public.user_wallets WHERE UPPER(asset_symbol::text) = 'BTC'), 0)::NUMERIC AS total_user_btc_balance,
    COALESCE((SELECT SUM(COALESCE(balance, 0) + COALESCE(locked_balance, 0)) FROM public.user_wallets WHERE UPPER(asset_symbol::text) = 'ETH'), 0)::NUMERIC AS total_user_eth_balance,
    COALESCE((SELECT SUM(COALESCE(balance, 0) + COALESCE(locked_balance, 0)) FROM public.user_wallets WHERE UPPER(asset_symbol::text) = 'LTC'), 0)::NUMERIC AS total_user_ltc_balance,
    COALESCE((SELECT SUM(COALESCE(amount_swept, 0)) FROM public.sweep_logs WHERE UPPER(status::text) = 'SUCCESS'), 0)::NUMERIC AS total_funds_swept,
    COALESCE((SELECT SUM(COALESCE(fee, 0)) FROM public.withdrawals WHERE UPPER(status::text) IN ('COMPLETED', 'CONFIRMED')), 0)::NUMERIC AS total_withdrawal_fees_collected,
    COALESCE((SELECT SUM(COALESCE(fee_amount, 0)) FROM public.escrow_ledger), 0)::NUMERIC AS total_p2p_fees_collected,
    COALESCE((SELECT COUNT(*) FROM public.withdrawals WHERE UPPER(status::text) = 'PENDING' OR requires_admin_approval = true), 0)::BIGINT AS pending_approvals_count;

GRANT SELECT ON public.admin_financial_overview TO authenticated, service_role;


-- 2. RLS Policies for sweep_logs and sweep_queue (Fixes Info 0008)
ALTER TABLE IF EXISTS public.sweep_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sweep_logs_service_role_all" ON public.sweep_logs;
CREATE POLICY "sweep_logs_service_role_all" ON public.sweep_logs
    FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE IF EXISTS public.sweep_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sweep_queue_service_role_all" ON public.sweep_queue;
CREATE POLICY "sweep_queue_service_role_all" ON public.sweep_queue
    FOR ALL USING (auth.role() = 'service_role');


-- 3. Hardened RLS policy for trade_attachments (Fixes Warn 0024)
-- Types: trade_attachments.trade_id is TEXT; trades.id is UUID; trades.trade_id is TEXT; trades.buyer_id is TEXT; trades.seller_id is TEXT.
ALTER TABLE IF EXISTS public.trade_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated users to read and insert trade attachments" ON public.trade_attachments;
DROP POLICY IF EXISTS "trade_attachments_participant_select" ON public.trade_attachments;
DROP POLICY IF EXISTS "trade_attachments_participant_insert" ON public.trade_attachments;

CREATE POLICY "trade_attachments_participant_select" ON public.trade_attachments
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.trades t
            WHERE (t.id::TEXT = trade_attachments.trade_id OR t.trade_id = trade_attachments.trade_id)
              AND (t.buyer_id = auth.uid()::TEXT OR t.seller_id = auth.uid()::TEXT)
        ) OR
        EXISTS (
            SELECT 1 FROM public.p2p_trades pt
            WHERE pt.id::TEXT = trade_attachments.trade_id
              AND (pt.buyer_id = auth.uid() OR pt.seller_id = auth.uid())
        ) OR
        EXISTS (
            SELECT 1 FROM public.app_admins a
            WHERE a.user_id = auth.uid()
        )
    );

CREATE POLICY "trade_attachments_participant_insert" ON public.trade_attachments
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role' OR
        sender_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.trades t
            WHERE (t.id::TEXT = trade_attachments.trade_id OR t.trade_id = trade_attachments.trade_id)
              AND (t.buyer_id = auth.uid()::TEXT OR t.seller_id = auth.uid()::TEXT)
        )
    );


-- 4. Revoke anon/public access from sensitive internal financial RPCs (Fixes Warn 0028 & 0029)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'credit_confirmed_deposit') THEN
    ALTER FUNCTION public.credit_confirmed_deposit(character varying, integer, character varying, uuid, character varying, numeric) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.credit_confirmed_deposit(character varying, integer, character varying, uuid, character varying, numeric) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.credit_confirmed_deposit(character varying, integer, character varying, uuid, character varying, numeric) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ingest_and_credit_deposit') THEN
    ALTER FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'process_user_deposit') THEN
    ALTER FUNCTION public.process_user_deposit(uuid, text, numeric, text, text, text, text) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, numeric, text, text, text, text) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_gas_funded') THEN
    ALTER FUNCTION public.mark_gas_funded(uuid, text) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.mark_gas_funded(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.mark_gas_funded(uuid, text) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_swept') THEN
    ALTER FUNCTION public.mark_swept(uuid, text) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.mark_swept(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.mark_swept(uuid, text) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_didit_kyc_status') THEN
    ALTER FUNCTION public.sync_didit_kyc_status(uuid, text, text, jsonb) SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.sync_didit_kyc_status(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.sync_didit_kyc_status(uuid, text, text, jsonb) TO service_role, postgres;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'cancel_expired_p2p_trades') THEN
    ALTER FUNCTION public.cancel_expired_p2p_trades() SET search_path = public, pg_temp;
    REVOKE EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.cancel_expired_p2p_trades() TO service_role, postgres;
  END IF;
END $$;


-- 5. Set explicit search_path on all system triggers and functions (Fixes Warn 0011)
DO $$
DECLARE
    f RECORD;
BEGIN
    FOR f IN (
        SELECT oid::regprocedure AS func_sig
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN (
            'handle_trade_volume_update',
            'handle_new_user_profile_sync',
            'expire_p2p_trade',
            'fn_sync_trade_status_timestamps',
            'handle_trade_status_sync',
            'handle_new_user_meta',
            'generate_random_username',
            'generate_pax_id',
            'execute_internal_transfer',
            'lock_seller_escrow',
            'fn_update_user_trade_metrics',
            'ensure_user_balance_wallet',
            'sync_wallet_locked_reserved_balances',
            'sync_deposit_addresses_to_profile',
            'sync_user_deposit_addresses_to_profile',
            'handle_new_user_wallets',
            'generate_transfer_public_id',
            'check_is_admin',
            'check_kyc_review_timeout',
            'initiate_didit_kyc',
            'initiate_p2p_trade'
          )
    ) LOOP
        BEGIN
            EXECUTE 'ALTER FUNCTION ' || f.func_sig || ' SET search_path = public, pg_temp;';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END LOOP;
END $$;
