-- Never use user-editable auth metadata to grant access to the platform ledger.
-- The table remains inaccessible to anonymous users; authenticated reads require
-- the self-bound, database-authoritative is_admin() check.
DROP POLICY IF EXISTS "Admins can view platform ledger"
    ON public.platform_ledger_entries;

CREATE POLICY "Admins can view platform ledger"
    ON public.platform_ledger_entries
    FOR SELECT
    TO authenticated
    USING ((SELECT public.is_admin()));

