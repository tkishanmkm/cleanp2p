-- Restrict direct chat/attachment inserts to actual trade participants.
-- Existing permissive policies allowed sender_id=auth.uid() alone, which did not
-- prove membership in the trade referenced by the inserted row.

DROP POLICY IF EXISTS "Trade chat participants can send messages" ON public.trade_chat_messages;

CREATE POLICY "Trade chat participants can send messages"
ON public.trade_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE t.id::text = trade_chat_messages.trade_id::text
      AND (
        t.buyer_id = (SELECT auth.uid())::text
        OR t.seller_id = (SELECT auth.uid())::text
      )
  )
);

DROP POLICY IF EXISTS "trade_attachments_participant_insert" ON public.trade_attachments;

CREATE POLICY "trade_attachments_participant_insert"
ON public.trade_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND (
    EXISTS (
      SELECT 1
      FROM public.trades t
      WHERE (
        t.id::text = trade_attachments.trade_id::text
        OR t.trade_id = trade_attachments.trade_id
      )
      AND (
        t.buyer_id = (SELECT auth.uid())::text
        OR t.seller_id = (SELECT auth.uid())::text
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.p2p_trades pt
      WHERE pt.id::text = trade_attachments.trade_id::text
        AND (
          pt.buyer_id = (SELECT auth.uid())
          OR pt.seller_id = (SELECT auth.uid())
        )
    )
  )
);
