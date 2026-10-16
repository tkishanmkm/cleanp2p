-- Harden the SECURITY DEFINER profile guard against search_path object shadowing.
-- All non-built-in objects referenced by this function are schema-qualified.
ALTER FUNCTION public.prevent_unauthorized_profile_updates() SET search_path = '';
