-- Scheduled maintenance routines mutate trade states and, in the expiry routine,
-- wallet balances. They must not be callable directly by client roles.
REVOKE EXECUTE ON FUNCTION public.cancel_expired_trades() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_trades() TO service_role;

REVOKE EXECUTE ON FUNCTION public.expire_unpaid_p2p_trades(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_p2p_trades(integer) TO service_role;

-- Administrative freeze routines have internal admin checks, but remove anonymous
-- entry points as defense in depth.
REVOKE EXECUTE ON FUNCTION public.admin_freeze_user(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid, text) FROM PUBLIC, anon;