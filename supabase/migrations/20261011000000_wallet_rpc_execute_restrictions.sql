-- Wallet security hotfix: restrict legacy balance-changing RPCs to trusted server-side calls.
-- The canonical deposit listener uses process_deposit_atomic, which is intentionally not changed here.
-- All server-side calls must use the Supabase service-role client; never expose its key to clients.

REVOKE ALL ON FUNCTION public.credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.credit_onchain_deposit(text, text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_onchain_deposit(text, text, numeric, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.process_deposit(uuid, character varying, numeric, character varying) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_deposit(uuid, character varying, numeric, character varying) TO service_role;

REVOKE ALL ON FUNCTION public.credit_user_balance(uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_user_balance(uuid, text, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.execute_wallet_transfer(uuid, uuid, text, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_wallet_transfer(uuid, uuid, text, numeric, numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_balance(character varying, uuid, character varying, character varying, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(character varying, uuid, character varying, character varying, numeric, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_balance(text, uuid, character varying, character varying, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(text, uuid, character varying, character varying, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_balance(text, uuid, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(text, uuid, text, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.admin_adjust_balance(uuid, uuid, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_balance(uuid, uuid, text, text, numeric, text) TO service_role;
