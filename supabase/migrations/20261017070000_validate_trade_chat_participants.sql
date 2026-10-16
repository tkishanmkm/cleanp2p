-- Chat messages must be tied to a trade the sender actually participates in.
-- The prior INSERT policy checked sender_id only and did not validate trade membership.
BEGIN;

DROP POLICY IF EXISTS "Trade chat participants can send messages"
ON public.trade_chat_messages;

CREATE POLICY "Trade chat participants can send messages"
ON public.trade_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND (
    EXISTS (
      SELECT 1
      FROM public.trades t
      WHERE t.id::text = trade_chat_messages.trade_id::text
        AND (
          t.buyer_id = (SELECT auth.uid())::text
          OR t.seller_id = (SELECT auth.uid())::text
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.p2p_trades pt
      WHERE pt.id::text = trade_chat_messages.trade_id::text
        AND (
          pt.buyer_id = (SELECT auth.uid())
          OR pt.seller_id = (SELECT auth.uid())
        )
    )
  )
);

REVOKE ALL PRIVILEGES ON TABLE public.trade_chat_messages FROM anon;

COMMIT;
