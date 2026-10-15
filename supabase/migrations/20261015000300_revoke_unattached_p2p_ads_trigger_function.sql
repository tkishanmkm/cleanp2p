-- This trigger function is not attached to any table trigger in the live schema.
-- Prevent direct Data API execution while the function is reviewed or retired.
REVOKE EXECUTE ON FUNCTION public.p2p_ads_insert_trigger() FROM PUBLIC, anon, authenticated;