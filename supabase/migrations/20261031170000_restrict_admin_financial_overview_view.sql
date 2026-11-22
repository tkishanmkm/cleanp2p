-- admin_financial_overview is an administrative aggregate. Its
-- security_invoker definition makes source-table RLS effective, but there is no
-- public application use for the view. Restrict direct access to the backend.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.admin_financial_overview
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.admin_financial_overview TO service_role;

COMMIT;
