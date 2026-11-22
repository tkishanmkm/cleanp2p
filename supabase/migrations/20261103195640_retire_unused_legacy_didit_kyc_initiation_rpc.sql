BEGIN;

-- The application uses initiate_didit_kyc_secure through the authenticated
-- server API. The older RPC has no source-code callers and is retired.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.initiate_didit_kyc(uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
