DROP POLICY IF EXISTS "Authenticated users can create own ads" ON public.ads;
CREATE POLICY "Authenticated users can create own ads"
  ON public.ads
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);