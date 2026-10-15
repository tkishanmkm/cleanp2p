-- Restrict direct client execution of the privileged dispute settlement RPC.
-- The admin API must authenticate the administrator before calling this as service_role.
BEGIN;

REVOKE ALL ON FUNCTION public.resolve_trade_dispute(uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute(uuid, text, uuid, uuid)
  TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.resolve_trade_dispute(uuid, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute resolve_trade_dispute';
  END IF;
  IF has_function_privilege('authenticated', 'public.resolve_trade_dispute(uuid, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute resolve_trade_dispute directly';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.resolve_trade_dispute(uuid, text, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute resolve_trade_dispute';
  END IF;
END;
$assert$;

COMMIT;
