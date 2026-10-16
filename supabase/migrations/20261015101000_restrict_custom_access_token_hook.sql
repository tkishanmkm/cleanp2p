-- Supabase Auth invokes this hook through supabase_auth_admin.
-- It simply returns the event unchanged; it is not a client-facing RPC.
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
