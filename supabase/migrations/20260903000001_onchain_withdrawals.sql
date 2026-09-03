-- ============================================================================
-- Supabase Migration: 20260903000001_onchain_withdrawals.sql
-- Description: Schema and policies for onchain_withdrawals hot-wallet dispatch
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.onchain_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
    to_address TEXT NOT NULL,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    asset_symbol TEXT NOT NULL DEFAULT 'USDT',
    network TEXT NOT NULL DEFAULT 'ERC20',
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'BROADCASTED', 'CONFIRMED', 'COMPLETED', 'FAILED', 'CANCELLED')),
    tx_hash TEXT,
    nonce BIGINT,
    error_message TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient sequential queue processing & lookups
CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_status_created ON public.onchain_withdrawals(status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_user_id ON public.onchain_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_tx_hash ON public.onchain_withdrawals(tx_hash);
CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_network ON public.onchain_withdrawals(network);

-- Enable RLS
ALTER TABLE public.onchain_withdrawals ENABLE ROW LEVEL SECURITY;

-- Policies
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'onchain_withdrawals' AND policyname = 'Users can view their own onchain withdrawals'
    ) THEN
        CREATE POLICY "Users can view their own onchain withdrawals"
            ON public.onchain_withdrawals
            FOR SELECT
            USING (
                auth.role() = 'authenticated' AND (
                    user_id = auth.uid()
                    OR EXISTS (
                        SELECT 1 FROM auth.users u
                        WHERE u.id = auth.uid()
                        AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                    )
                )
            );
    END IF;
END $$;
