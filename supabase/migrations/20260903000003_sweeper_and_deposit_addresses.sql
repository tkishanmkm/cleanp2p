-- ============================================================================
-- Supabase Migration: 20260903000003_sweeper_and_deposit_addresses.sql
-- Description: Schema updates for automated deposit address sweeper and user_deposit_addresses
-- ============================================================================

-- 1. Ensure user_deposit_addresses exists
CREATE TABLE IF NOT EXISTS public.user_deposit_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_id UUID REFERENCES public.wallets(id) ON DELETE CASCADE,
    address TEXT NOT NULL,
    network TEXT NOT NULL,
    asset_symbol TEXT NOT NULL DEFAULT 'USDT',
    derivation_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_deposit_addresses_addr_net UNIQUE (address, network)
);

CREATE INDEX IF NOT EXISTS idx_user_deposit_addresses_user_id ON public.user_deposit_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_deposit_addresses_address ON public.user_deposit_addresses(address);
CREATE INDEX IF NOT EXISTS idx_user_deposit_addresses_network ON public.user_deposit_addresses(network);

-- Enable RLS
ALTER TABLE public.user_deposit_addresses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'user_deposit_addresses' AND policyname = 'Users can view their own deposit addresses'
    ) THEN
        CREATE POLICY "Users can view their own deposit addresses"
            ON public.user_deposit_addresses
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

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'user_deposit_addresses' AND policyname = 'Service role full access to user_deposit_addresses'
    ) THEN
        CREATE POLICY "Service role full access to user_deposit_addresses"
            ON public.user_deposit_addresses
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 2. Ensure columns on onchain_deposits for sweeping
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_deposits' AND column_name = 'is_swept'
    ) THEN
        ALTER TABLE public.onchain_deposits ADD COLUMN is_swept BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_deposits' AND column_name = 'swept_tx_hash'
    ) THEN
        ALTER TABLE public.onchain_deposits ADD COLUMN swept_tx_hash TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'onchain_deposits' AND column_name = 'address'
    ) THEN
        ALTER TABLE public.onchain_deposits ADD COLUMN address TEXT;
        -- Backfill address from to_address if exists
        UPDATE public.onchain_deposits SET address = to_address WHERE address IS NULL AND to_address IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_onchain_deposits_sweeper ON public.onchain_deposits(status, is_swept);
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_address ON public.onchain_deposits(address);
