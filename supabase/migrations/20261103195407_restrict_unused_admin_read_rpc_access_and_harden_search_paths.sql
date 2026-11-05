BEGIN;

-- These RPCs have no application callsites. Keep server-side access where it
-- may still be needed, but remove direct Data API access by signed-in clients.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_emergency_mode()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_my_kyc_info()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_user_2fa_status(uuid)
  FROM PUBLIC, anon, authenticated;

-- is_admin() has no direct application callsite. Other SECURITY DEFINER
-- functions and protected triggers can still invoke it as their owner.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.is_admin()
  FROM PUBLIC, anon, authenticated;

-- Remove ambient schema resolution from all currently used authenticated
-- security-definer identity and user-action RPCs. Every object reference in
-- these functions is schema-qualified.
ALTER FUNCTION public.check_is_admin(uuid,uuid)
  SET search_path = '';

ALTER FUNCTION public.verify_admin_login(uuid,uuid)
  SET search_path = '';

ALTER FUNCTION public.get_emergency_mode()
  SET search_path = '';

ALTER FUNCTION public.get_my_kyc_info()
  SET search_path = '';

ALTER FUNCTION public.get_user_2fa_status(uuid)
  SET search_path = '';

ALTER FUNCTION public.initiate_didit_kyc(uuid,text)
  SET search_path = '';

ALTER FUNCTION public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)
  SET search_path = '';

ALTER FUNCTION public.is_admin()
  SET search_path = '';

ALTER FUNCTION public.raise_trade_dispute(uuid,uuid,text)
  SET search_path = '';

COMMIT;
