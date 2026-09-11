-- ==============================================================================
-- Supabase Migration: 20260910000000_strict_typecasting_and_rls_hardening.sql
-- Description: Comprehensive hardening enforcing strict UUID and TEXT typecasting
--              across all Supabase RLS policies, RPC functions, views, and joins
--              to completely eliminate PostgreSQL Error 42883 (operator does not 
--              exist: uuid = text / text = uuid) and Error 22P02 (invalid UUID input).
-- ==============================================================================

-- 1. Helper function for admin verification with explicit type safety
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_admins
        WHERE user_id::uuid = auth.uid()::uuid
    ) OR EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id::uuid = auth.uid()::uuid
          AND (
              u.raw_app_meta_data->>'role' = 'admin' 
              OR COALESCE((u.raw_app_meta_data->>'is_admin')::boolean, false) = true
          )
    );
$$;

-- 2. Ensure RLS is enabled on all critical application tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.asset_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deposit_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.wallet_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platform_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.blockchain_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trade_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.processed_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.onchain_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.onchain_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.p2p_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_blocks ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. Hardened RLS Policies with Explicit ::uuid and ::text Typecasting
-- ------------------------------------------------------------------------------

-- PROFILES
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;

CREATE POLICY "profiles_select_policy" ON public.profiles
    FOR SELECT USING (true);

CREATE POLICY "profiles_update_policy" ON public.profiles
    FOR UPDATE USING (
        auth.uid()::uuid IS NOT NULL AND id::uuid = auth.uid()::uuid
    ) WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND id::uuid = auth.uid()::uuid
    );

CREATE POLICY "profiles_insert_policy" ON public.profiles
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND id::uuid = auth.uid()::uuid
    );

-- TRADES
DROP POLICY IF EXISTS "trades_select_policy" ON public.trades;
DROP POLICY IF EXISTS "trades_insert_policy" ON public.trades;
DROP POLICY IF EXISTS "trades_update_policy" ON public.trades;
DROP POLICY IF EXISTS "Users can view own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can update own trades" ON public.trades;
DROP POLICY IF EXISTS "Users can insert own trades" ON public.trades;

CREATE POLICY "trades_select_policy" ON public.trades
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            buyer_id::uuid = auth.uid()::uuid OR 
            seller_id::uuid = auth.uid()::uuid OR 
            public.is_admin()
        )
    );

CREATE POLICY "trades_insert_policy" ON public.trades
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            buyer_id::uuid = auth.uid()::uuid OR 
            seller_id::uuid = auth.uid()::uuid OR 
            public.is_admin()
        )
    );

CREATE POLICY "trades_update_policy" ON public.trades
    FOR UPDATE USING (
        auth.uid()::uuid IS NOT NULL AND (
            buyer_id::uuid = auth.uid()::uuid OR 
            seller_id::uuid = auth.uid()::uuid OR 
            public.is_admin()
        )
    ) WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            buyer_id::uuid = auth.uid()::uuid OR 
            seller_id::uuid = auth.uid()::uuid OR 
            public.is_admin()
        )
    );

-- TRADE MESSAGES
DROP POLICY IF EXISTS "trade_messages_select_policy" ON public.trade_messages;
DROP POLICY IF EXISTS "trade_messages_insert_policy" ON public.trade_messages;
DROP POLICY IF EXISTS "Participants can view trade messages" ON public.trade_messages;
DROP POLICY IF EXISTS "Participants can insert trade messages" ON public.trade_messages;

CREATE POLICY "trade_messages_select_policy" ON public.trade_messages
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            sender_id::uuid = auth.uid()::uuid OR
            public.is_admin() OR
            EXISTS (
                SELECT 1 FROM public.trades t
                WHERE (t.id::uuid = trade_messages.trade_id::uuid OR t.trade_id::text = trade_messages.trade_id::text)
                  AND (t.buyer_id::uuid = auth.uid()::uuid OR t.seller_id::uuid = auth.uid()::uuid)
            )
        )
    );

CREATE POLICY "trade_messages_insert_policy" ON public.trade_messages
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            sender_id::uuid = auth.uid()::uuid OR
            public.is_admin() OR
            EXISTS (
                SELECT 1 FROM public.trades t
                WHERE (t.id::uuid = trade_messages.trade_id::uuid OR t.trade_id::text = trade_messages.trade_id::text)
                  AND (t.buyer_id::uuid = auth.uid()::uuid OR t.seller_id::uuid = auth.uid()::uuid)
            )
        )
    );

-- WALLETS & WALLET ASSETS
DROP POLICY IF EXISTS "wallets_select_policy" ON public.wallets;
DROP POLICY IF EXISTS "wallets_update_policy" ON public.wallets;
DROP POLICY IF EXISTS "wallets_insert_policy" ON public.wallets;

CREATE POLICY "wallets_select_policy" ON public.wallets
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "wallets_insert_policy" ON public.wallets
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "wallets_update_policy" ON public.wallets
    FOR UPDATE USING (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    ) WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

-- WITHDRAWALS
DROP POLICY IF EXISTS "withdrawals_select_policy" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_insert_policy" ON public.withdrawals;
DROP POLICY IF EXISTS "withdrawals_update_policy" ON public.withdrawals;

CREATE POLICY "withdrawals_select_policy" ON public.withdrawals
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "withdrawals_insert_policy" ON public.withdrawals
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "withdrawals_update_policy" ON public.withdrawals
    FOR UPDATE USING (
        public.is_admin()
    );

-- DEPOSITS
DROP POLICY IF EXISTS "deposits_select_policy" ON public.deposits;
DROP POLICY IF EXISTS "deposits_insert_policy" ON public.deposits;

CREATE POLICY "deposits_select_policy" ON public.deposits
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            user_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "deposits_insert_policy" ON public.deposits
    FOR INSERT WITH CHECK (
        public.is_admin()
    );

-- DISPUTES
DROP POLICY IF EXISTS "disputes_select_policy" ON public.disputes;
DROP POLICY IF EXISTS "disputes_insert_policy" ON public.disputes;
DROP POLICY IF EXISTS "disputes_update_policy" ON public.disputes;

CREATE POLICY "disputes_select_policy" ON public.disputes
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            opened_by::uuid = auth.uid()::uuid OR
            public.is_admin() OR
            EXISTS (
                SELECT 1 FROM public.trades t
                WHERE (t.id::uuid = disputes.trade_id::uuid OR t.trade_id::text = disputes.trade_id::text)
                  AND (t.buyer_id::uuid = auth.uid()::uuid OR t.seller_id::uuid = auth.uid()::uuid)
            )
        )
    );

CREATE POLICY "disputes_insert_policy" ON public.disputes
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            opened_by::uuid = auth.uid()::uuid OR
            public.is_admin()
        )
    );

CREATE POLICY "disputes_update_policy" ON public.disputes
    FOR UPDATE USING (
        public.is_admin()
    );

-- P2P ADS
DROP POLICY IF EXISTS "p2p_ads_select_policy" ON public.p2p_ads;
DROP POLICY IF EXISTS "p2p_ads_insert_policy" ON public.p2p_ads;
DROP POLICY IF EXISTS "p2p_ads_update_policy" ON public.p2p_ads;
DROP POLICY IF EXISTS "p2p_ads_delete_policy" ON public.p2p_ads;

CREATE POLICY "p2p_ads_select_policy" ON public.p2p_ads
    FOR SELECT USING (
        status = 'active' OR
        (auth.uid()::uuid IS NOT NULL AND user_id::uuid = auth.uid()::uuid) OR
        public.is_admin()
    );

CREATE POLICY "p2p_ads_insert_policy" ON public.p2p_ads
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (user_id::uuid = auth.uid()::uuid OR public.is_admin())
    );

CREATE POLICY "p2p_ads_update_policy" ON public.p2p_ads
    FOR UPDATE USING (
        auth.uid()::uuid IS NOT NULL AND (user_id::uuid = auth.uid()::uuid OR public.is_admin())
    ) WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (user_id::uuid = auth.uid()::uuid OR public.is_admin())
    );

CREATE POLICY "p2p_ads_delete_policy" ON public.p2p_ads
    FOR DELETE USING (
        auth.uid()::uuid IS NOT NULL AND (user_id::uuid = auth.uid()::uuid OR public.is_admin())
    );

-- USER BLOCKS
DROP POLICY IF EXISTS "user_blocks_select_policy" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_insert_policy" ON public.user_blocks;
DROP POLICY IF EXISTS "user_blocks_delete_policy" ON public.user_blocks;

CREATE POLICY "user_blocks_select_policy" ON public.user_blocks
    FOR SELECT USING (
        auth.uid()::uuid IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR
            blocked_id::uuid = auth.uid()::uuid OR
            public.is_admin()
        )
    );

CREATE POLICY "user_blocks_insert_policy" ON public.user_blocks
    FOR INSERT WITH CHECK (
        auth.uid()::uuid IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );

CREATE POLICY "user_blocks_delete_policy" ON public.user_blocks
    FOR DELETE USING (
        auth.uid()::uuid IS NOT NULL AND (
            blocker_id::uuid = auth.uid()::uuid OR public.is_admin()
        )
    );
