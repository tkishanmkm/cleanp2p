-- ============================================================================
-- Supabase Migration: 20260831000001_realtime_chat.sql
-- Description: Realtime P2P Trade Chat System with Row Level Security & Realtime publication
-- ============================================================================

-- 1. Create trade_messages table
CREATE TABLE IF NOT EXISTS public.trade_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id TEXT NOT NULL,
    sender_id UUID NOT NULL,
    message TEXT NOT NULL,
    attachment_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for high-performance retrieval by trade_id ordered by created_at
CREATE INDEX IF NOT EXISTS idx_trade_messages_trade_id ON public.trade_messages(trade_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_trade_messages_sender_id ON public.trade_messages(sender_id);

-- 2. Enable Row Level Security
ALTER TABLE public.trade_messages ENABLE ROW LEVEL SECURITY;

-- 3. RLS Policies
-- Users can select/read messages if they belong to the trade or are admin
CREATE POLICY "Users and admins can view trade messages"
    ON public.trade_messages
    FOR SELECT
    USING (
        auth.role() = 'authenticated' AND (
            sender_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.trades t
                WHERE (t.id::text = trade_messages.trade_id OR t.firestore_trade_id = trade_messages.trade_id)
                AND (t.buyer_id = auth.uid() OR t.seller_id = auth.uid())
            )
            OR EXISTS (
                SELECT 1 FROM auth.users u
                WHERE u.id = auth.uid()
                AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
            )
        )
    );

-- Users can insert messages into their trades
CREATE POLICY "Users can insert trade messages"
    ON public.trade_messages
    FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND (
            sender_id = auth.uid()
            AND (
                EXISTS (
                    SELECT 1 FROM public.trades t
                    WHERE (t.id::text = trade_messages.trade_id OR t.firestore_trade_id = trade_messages.trade_id)
                    AND (t.buyer_id = auth.uid() OR t.seller_id = auth.uid())
                )
                OR EXISTS (
                    SELECT 1 FROM auth.users u
                    WHERE u.id = auth.uid()
                    AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
                )
            )
        )
    );

-- 4. Enable Supabase Realtime for trade_messages table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'trade_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_messages;
    END IF;
END $$;
