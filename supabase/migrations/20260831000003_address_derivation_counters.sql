-- Migration: 20260831000003_address_derivation_counters.sql
-- Create address derivation counter table for atomic HD wallet indexing

CREATE TABLE IF NOT EXISTS public.address_derivation_counters (
    chain TEXT PRIMARY KEY,
    next_index INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pre-seed standard chains
INSERT INTO public.address_derivation_counters (chain, next_index)
VALUES 
    ('EVM', 1),
    ('BTC', 1),
    ('LTC', 1),
    ('TRON', 1)
ON CONFLICT (chain) DO NOTHING;

-- RLS: Enable RLS, allow service role / admin full access
ALTER TABLE public.address_derivation_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to address_derivation_counters"
    ON public.address_derivation_counters
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
