-- Reassert the canonical RPC's intended server-only execution boundary.
-- The exact overload is pinned so future overloads do not inherit accidental
-- assumptions about privileges.
REVOKE ALL ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) FROM anon;

REVOKE ALL ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) FROM authenticated;

REVOKE ALL ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) FROM supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) TO service_role, postgres;
