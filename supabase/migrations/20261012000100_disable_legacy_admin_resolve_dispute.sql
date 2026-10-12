-- Security mitigation for the legacy admin_resolve_dispute RPC.
--
-- The current application dispute routes use release_trade_escrow / cancel_p2p_trade,
-- not this function. This RPC trusts p_admin_id and moves balances in the legacy
-- public.wallets table. Keep it unavailable to all API roles until a replacement
-- is designed and tested against the canonical escrow ledger.
--
-- This migration intentionally disables invocation rather than attempting an
-- unverified financial rewrite. The function owner can still inspect/replace it.

REVOKE EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('supabase_auth_admin', 'public.admin_resolve_dispute(uuid,uuid,text,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'admin_resolve_dispute remains executable by an API role';
  END IF;
END
$verify$;
