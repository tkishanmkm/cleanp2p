-- The function exposes block relationship counts for any supplied user ID.
-- No legitimate app caller was found; keep it server-side until a scoped use is implemented.
REVOKE EXECUTE ON FUNCTION public.get_user_block_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_block_counts(uuid) TO service_role;
