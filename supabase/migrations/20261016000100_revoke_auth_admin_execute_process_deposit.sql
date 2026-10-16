-- Restrict the privileged deposit-credit RPC to the service role.
-- Production inspection confirmed anon/authenticated cannot execute this function,
-- but supabase_auth_admin also had EXECUTE. Deposit ingestion is an application
-- worker responsibility; the Auth admin role must not be able to credit balances.
-- Apply in staging first and validate worker ingestion before any production rollout.

REVOKE EXECUTE ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) FROM supabase_auth_admin;
