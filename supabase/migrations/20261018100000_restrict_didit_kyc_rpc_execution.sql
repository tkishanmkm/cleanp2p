-- Restrict the legacy KYC session-initiation RPC to trusted server callers.
-- It accepts a caller-supplied user ID and vendor session ID, so it must not be
-- exposed directly to anon/authenticated clients. Local-only; validate before deploy.
BEGIN;

REVOKE ALL ON FUNCTION public.initiate_didit_kyc(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_didit_kyc(uuid, text)
  TO service_role, postgres;

-- The function body schema-qualifies its application objects; remove ambient
-- search_path resolution from this SECURITY DEFINER function.
ALTER FUNCTION public.initiate_didit_kyc(uuid, text)
  SET search_path = '';

COMMIT;
