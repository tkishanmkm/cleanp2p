-- Attachment uploads must be tied to a trade the authenticated uploader
-- actually participates in; sender_id alone is not proof of membership.
BEGIN;

DROP POLICY IF EXISTS "trade_attachments_participant_insert"
ON public.trade_attachments;

CREATE POLICY "trade_attachments_participant_insert"
ON public.trade_attachments
FOR INSERT
TO authenticated, service_role
WITH CHECK (
  auth.role() = 'service_role'
  OR (
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
  )
);

COMMIT;
