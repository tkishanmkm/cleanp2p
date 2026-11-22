-- Both overloads mutate KYC status/attempt counters for an arbitrary supplied user.
-- No repository callers were found; keep these privileged until an authenticated, ownership-checked flow is implemented.
REVOKE EXECUTE ON FUNCTION public.record_kyc_failure(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_kyc_failure(uuid, text, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.record_kyc_failure(uuid, public.kyc_status_enum, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_kyc_failure(uuid, public.kyc_status_enum, text, text, jsonb) TO service_role;
