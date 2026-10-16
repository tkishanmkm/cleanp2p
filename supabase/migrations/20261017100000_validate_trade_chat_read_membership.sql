-- Ensure chat history is readable only by participants of the referenced trade,
-- supporting both legacy trades and p2p_trades.
BEGIN;

DROP POLICY IF EXISTS "Trade chat participants can view messages"
ON public.trade_chat_messages;

CREATE POLICY "Trade chat participants can view messages"
ON public.trade_chat_messages
FOR SELECT
TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE t.id::text = trade_chat_messages.trade_id::text
      AND (
        t.buyer_id::text = (SELECT auth.uid())::text
        OR t.seller_id::text = (SELECT auth.uid())::text
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.p2p_trades pt
    WHERE pt.id = trade_chat_messages.trade_id
      AND (
        pt.buyer_id = (SELECT auth.uid())
        OR pt.seller_id = (SELECT auth.uid())
      )
  )
);

COMMIT;
