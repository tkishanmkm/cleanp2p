-- Lock down legacy trade tables so client writes cannot mutate escrow state or
-- inject attachment records. Current application mutation paths use trusted server
-- routes / SECURITY DEFINER RPCs; clients only need participant read access to
-- legacy p2p_trades. trade_attachments is not written/read directly by current src.
-- Prepared locally only. Do not apply until replayed against an isolated schema.
BEGIN;

-- Participants may read their own legacy trades, but all trade-state mutations must
-- go through the canonical trusted routes/RPCs. A row-level participant predicate
-- alone is not sufficient: it would permit changing amount/status/escrow hashes.
DROP POLICY IF EXISTS "Users can update their own trades" ON public.p2p_trades;
DROP POLICY IF EXISTS "Users can view their own trades" ON public.p2p_trades;

REVOKE ALL PRIVILEGES ON TABLE public.p2p_trades FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.p2p_trades TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.p2p_trades TO service_role;

CREATE POLICY "Authenticated participants can view their own legacy trades"
    ON public.p2p_trades
    FOR SELECT
    TO authenticated
    USING (
        buyer_id = (SELECT auth.uid())
        OR seller_id = (SELECT auth.uid())
    );

-- The legacy attachment INSERT predicate previously accepted sender_id = auth.uid()
-- without proving that the sender participated in the referenced trade. The current
-- B2 upload flow persists through the server-side trade_files/trade_messages routes,
-- so the unused legacy table is service-role-only until a participant-safe API exists.
DROP POLICY IF EXISTS "trade_attachments_participant_insert" ON public.trade_attachments;
DROP POLICY IF EXISTS "trade_attachments_participant_select" ON public.trade_attachments;

REVOKE ALL PRIVILEGES ON TABLE public.trade_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trade_attachments TO service_role;

CREATE POLICY "Service role can manage legacy trade attachments"
    ON public.trade_attachments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMIT;
