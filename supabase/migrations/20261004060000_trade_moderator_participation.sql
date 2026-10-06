-- Migration: 20261004060000_trade_moderator_participation.sql
-- Description: Idempotent trade moderator participation table with RLS and fully qualified column references to prevent column shadowing and uuid=text type mismatches.

CREATE TABLE IF NOT EXISTS public.trade_moderator_participations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (trade_id, moderator_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_moderator_trade ON public.trade_moderator_participations(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_moderator_mod ON public.trade_moderator_participations(moderator_id);

ALTER TABLE public.trade_moderator_participations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trade_moderator_participations_select" ON public.trade_moderator_participations;
DROP POLICY IF EXISTS "trade_moderator_participations_mutate" ON public.trade_moderator_participations;

CREATE POLICY "trade_moderator_participations_select" ON public.trade_moderator_participations
    FOR SELECT USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()::uuid
              AND (p.role = 'admin' OR p.is_admin = true OR p.is_admin_account = true)
        ) OR
        EXISTS (
            SELECT 1 FROM public.trades t
            WHERE t.id = public.trade_moderator_participations.trade_id
              AND (t.buyer_id::text = auth.uid()::text OR t.seller_id::text = auth.uid()::text)
        )
    );

CREATE POLICY "trade_moderator_participations_mutate" ON public.trade_moderator_participations
    FOR ALL USING (
        auth.role() = 'service_role' OR
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()::uuid
              AND (p.role = 'admin' OR p.is_admin = true OR p.is_admin_account = true)
        )
    );
