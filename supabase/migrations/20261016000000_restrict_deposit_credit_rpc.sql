-- Restrict privileged deposit-crediting RPCs to the trusted server role.
-- These SECURITY DEFINER functions mutate wallet balances and must never be callable
-- by browser-authenticated users or the PUBLIC pseudo-role.
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_confirmed_deposit(uuid, numeric, text, text, text) TO service_role;
