-- Permit trade participants to view evidence files attached to their own trade,
-- while keeping unrelated users' files private.
BEGIN;

DROP POLICY IF EXISTS "Users can access files for their trades"
ON public.trade_files;

CREATE POLICY "Users can access files for their trades"
ON public.trade_files
FOR SELECT
TO authenticated, service_role
USING (
  auth.role() = 'service_role'
  OR uploaded_by = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.trades t
    WHERE t.id = trade_files.trade_id
      AND (
        t.buyer_id = (SELECT auth.uid())::text
        OR t.seller_id = (SELECT auth.uid())::text
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.p2p_trades pt
    WHERE pt.id = trade_files.trade_id
      AND (
        pt.buyer_id = (SELECT auth.uid())
        OR pt.seller_id = (SELECT auth.uid())
      )
  )
  OR EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = (SELECT auth.uid())
  )
);

COMMIT;
