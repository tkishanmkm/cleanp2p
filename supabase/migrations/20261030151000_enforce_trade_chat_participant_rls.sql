-- Trade chat rows are private to the buyer and seller of the referenced trade.
-- A sender matching auth.uid() alone must never grant access to an unrelated trade.
DROP POLICY IF EXISTS "Trade chat participants can send messages" ON public.trade_chat_messages;
CREATE POLICY "Trade chat participants can send messages"
ON public.trade_chat_messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE (
      t.id = trade_chat_messages.trade_id
      OR t.trade_id = trade_chat_messages.trade_id::text
    )
    AND (
      t.buyer_id = (SELECT auth.uid())::text
      OR t.seller_id = (SELECT auth.uid())::text
    )
  )
);

-- Attachments require both sender identity and participation in the referenced trade.
DROP POLICY IF EXISTS trade_attachments_participant_insert ON public.trade_attachments;
CREATE POLICY trade_attachments_participant_insert
ON public.trade_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = (SELECT auth.uid())
  AND EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE (
      t.id::text = trade_attachments.trade_id
      OR t.trade_id = trade_attachments.trade_id
    )
    AND (
      t.buyer_id = (SELECT auth.uid())::text
      OR t.seller_id = (SELECT auth.uid())::text
    )
  )
);

-- A sender must not be able to read their own message if it belongs to another
-- user's trade. Service role and verified admins retain their existing access.
DROP POLICY IF EXISTS trade_messages_select_policy ON public.trade_messages;
CREATE POLICY trade_messages_select_policy
ON public.trade_messages
FOR SELECT
TO authenticated
USING (
  auth.role() = 'service_role'
  OR is_admin()
  OR EXISTS (
    SELECT 1
    FROM public.trades AS t
    WHERE t.id::text = trade_messages.trade_id
      AND (
        t.buyer_id = (SELECT auth.uid())::text
        OR t.seller_id = (SELECT auth.uid())::text
      )
  )
);
