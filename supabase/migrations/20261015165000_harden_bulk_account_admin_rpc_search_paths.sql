-- Harden SECURITY DEFINER bulk account-management RPCs against search_path object shadowing.
-- Application tables and auth helpers referenced by these functions are schema-qualified;
-- built-in functions remain resolvable through PostgreSQL's implicit pg_catalog.
ALTER FUNCTION public.execute_bulk_ban_atomic(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.execute_bulk_restrict_atomic(uuid, text, text) SET search_path = '';
ALTER FUNCTION public.execute_bulk_unban_atomic(uuid, text) SET search_path = '';
ALTER FUNCTION public.execute_bulk_unrestrict_atomic(uuid, text) SET search_path = '';
