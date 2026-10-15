REVOKE EXECUTE ON FUNCTION public.release_seller_escrow(uuid, uuid, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_seller_escrow(uuid, uuid, numeric, numeric) TO service_role;
