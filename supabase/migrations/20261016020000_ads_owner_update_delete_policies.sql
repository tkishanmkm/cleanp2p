-- Allow authenticated users to manage only advertisements they own.
-- WITH CHECK prevents changing ownership to another account.
BEGIN;

DROP POLICY IF EXISTS "Owners can update own ads" ON public.ads;
CREATE POLICY "Owners can update own ads"
  ON public.ads
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners can delete own ads" ON public.ads;
CREATE POLICY "Owners can delete own ads"
  ON public.ads
  FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

GRANT UPDATE, DELETE ON public.ads TO authenticated;

COMMIT;
