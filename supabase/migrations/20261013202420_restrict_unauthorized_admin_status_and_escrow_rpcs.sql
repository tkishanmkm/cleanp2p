
BEGIN;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_status(text, uuid, public.user_status_enum, text, public.ban_withdrawal_policy_enum)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_release_escrow(character varying, uuid, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_dispute(uuid, uuid, text, text)
  FROM anon, authenticated;
COMMIT;
