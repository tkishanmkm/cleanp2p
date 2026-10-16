-- Harden SECURITY DEFINER admin role-management and login-verification RPCs.
-- Function references use explicit schemas; an empty search_path prevents attacker-controlled object shadowing.
ALTER FUNCTION public.admin_update_user_role(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.verify_admin_login(uuid, uuid) SET search_path = '';
