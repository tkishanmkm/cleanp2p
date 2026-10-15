-- HD address derivation indexes are privileged wallet state; clients must not advance them.
REVOKE EXECUTE ON FUNCTION public.get_next_hd_index(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_hd_index(text, text) TO service_role;
