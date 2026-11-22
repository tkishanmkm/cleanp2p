-- Restrict canonical public.ads reads to active, non-deleted advertisements.
-- Owners may still read their own non-deleted ads, including paused drafts.
-- Prepared locally only. Validate against an isolated schema before deployment.
BEGIN;

DROP POLICY IF EXISTS "Allow public read access for ads" ON public.ads;
DROP POLICY IF EXISTS "Public can read active nondeleted ads" ON public.ads;
CREATE POLICY "Public can read active nondeleted ads"
ON public.ads
FOR SELECT
TO public
USING (
    NOT COALESCE(is_deleted, false)
    AND UPPER(COALESCE(status, '')) <> 'DELETED'
    AND (
        COALESCE(active, false)
        OR COALESCE(is_active, false)
        OR LOWER(COALESCE(status, '')) IN ('active', 'published')
    )
);

DROP POLICY IF EXISTS "Owners can read their nondeleted ads" ON public.ads;
CREATE POLICY "Owners can read their nondeleted ads"
ON public.ads
FOR SELECT
TO authenticated
USING (
    auth.uid() = user_id
    AND NOT COALESCE(is_deleted, false)
    AND UPPER(COALESCE(status, '')) <> 'DELETED'
);

COMMIT;
