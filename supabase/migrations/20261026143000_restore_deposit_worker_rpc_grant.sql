-- Restore the intended trusted-worker EXECUTE grant on the canonical deposit processor.
-- Production read-only inspection found the live overload is not executable by service_role,
-- while the confirmation worker calls it through the service-role Supabase client.
-- Candidate only: verify the exact overload and rehearse before deployment.
BEGIN;

REVOKE ALL ON FUNCTION public.process_deposit_atomic(
    TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER, BIGINT, TEXT, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.process_deposit_atomic(
    TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER, BIGINT, TEXT, TEXT, INTEGER, TEXT
) TO service_role, postgres;

COMMIT;
