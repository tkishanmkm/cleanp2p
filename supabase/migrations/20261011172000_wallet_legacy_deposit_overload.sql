-- The four-argument overload was still publicly executable and accepts
-- user ID, chain, transaction hash and amount from the caller.
REVOKE ALL ON FUNCTION public.process_user_deposit(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_user_deposit(uuid, text, text, numeric) TO service_role;
