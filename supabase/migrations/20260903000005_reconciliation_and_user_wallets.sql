-- ============================================================================
-- Supabase Migration: 20260903000005_reconciliation_and_user_wallets.sql
-- Description: System reconciliation snapshot table and user_wallets view
-- ============================================================================

-- 1. Table for storing periodic balance & gas reconciliation snapshots
CREATE TABLE IF NOT EXISTS public.system_reconciliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_symbol TEXT NOT NULL DEFAULT 'USDT',
    db_liability NUMERIC(36, 18) NOT NULL DEFAULT 0.0,
    onchain_balance NUMERIC(36, 18) NOT NULL DEFAULT 0.0,
    discrepancy NUMERIC(36, 18) NOT NULL DEFAULT 0.0,
    is_balanced BOOLEAN NOT NULL DEFAULT TRUE,
    gas_snapshot JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_reconciliations_created_at 
    ON public.system_reconciliations(created_at DESC);

-- Enable RLS
ALTER TABLE public.system_reconciliations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'system_reconciliations' AND policyname = 'Admins can view system reconciliations'
    ) THEN
        CREATE POLICY "Admins can view system reconciliations"
            ON public.system_reconciliations
            FOR SELECT
            USING (
                auth.role() = 'authenticated' AND (
                    EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = auth.uid()
                        AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                    )
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'system_reconciliations' AND policyname = 'Service role full access to system_reconciliations'
    ) THEN
        CREATE POLICY "Service role full access to system_reconciliations"
            ON public.system_reconciliations
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 2. Ensure fee column on onchain_withdrawals
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_withdrawals' AND column_name = 'fee'
    ) THEN
        ALTER TABLE public.onchain_withdrawals ADD COLUMN fee NUMERIC(36, 18) DEFAULT 0.0;
    END IF;
END $$;

-- 3. Unified user_wallets view mapping wallet_assets to user spot balances
CREATE OR REPLACE VIEW public.user_wallets AS
SELECT 
    wa.wallet_id,
    w.user_id,
    wa.asset_code AS asset_symbol,
    wa.available AS main_balance,
    (wa.locked_escrow + wa.locked_withdrawal) AS locked_balance,
    wa.updated_at
FROM public.wallet_assets wa
JOIN public.wallets w ON w.id = wa.wallet_id;
