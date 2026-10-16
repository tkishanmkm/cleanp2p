-- Harden SECURITY DEFINER emergency admin RPCs against search_path object shadowing.
-- These functions reference application objects using schema-qualified names.
ALTER FUNCTION public.admin_freeze_user(uuid, text) SET search_path = '';
ALTER FUNCTION public.admin_unfreeze_user(uuid, text) SET search_path = '';
ALTER FUNCTION public.admin_set_emergency_mode(boolean, text) SET search_path = '';
