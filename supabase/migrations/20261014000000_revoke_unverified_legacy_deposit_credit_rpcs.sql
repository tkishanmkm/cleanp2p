-- Fail closed: legacy deposit-credit RPCs have not passed independent
-- on-chain evidence and caller-boundary verification. Automatic credit remains
-- disabled in the application; revoke service_role execution until a verified
-- replacement flow is implemented and audited.
--
-- These REVOKEs are intentionally limited to deposit-credit entry points.
-- postgres/function owner retains administrative ability to restore access.

REVOKE EXECUTE ON FUNCTION public.credit_confirmed_deposit(character varying, integer, character varying, uuid, character varying, numeric) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.credit_onchain_deposit(text, text, numeric, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_deposit(uuid, character varying, numeric, character varying) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_deposit_atomic(text, text, text, numeric, text, integer, bigint, text, text, integer, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_incoming_deposit(text, text, text, numeric, text, integer) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, numeric, text, text, text, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, text, numeric) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, text, text, numeric, text) FROM service_role;
REVOKE EXECUTE ON FUNCTION public.process_user_deposit(uuid, uuid, text, text, numeric, text, text, integer) FROM service_role;
