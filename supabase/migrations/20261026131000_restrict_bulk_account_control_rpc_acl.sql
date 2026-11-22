-- Restrict high-impact bulk account-control RPCs to trusted server-side callers.
-- The app invokes these through /api/admin/platform-controls/bulk after verifyServerAdmin().
-- Candidate only: verify every call site before deployment; do not apply to production blindly.
BEGIN;

REVOKE ALL ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.execute_bulk_ban_atomic(UUID, TEXT, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unban_atomic(UUID, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.execute_bulk_restrict_atomic(UUID, TEXT, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unrestrict_atomic(UUID, TEXT)
    TO service_role, postgres;

COMMIT;
