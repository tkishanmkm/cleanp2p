-- Harden reviewed SECURITY DEFINER RPCs against search_path object shadowing.
-- Each target's table and auth-helper references were inspected in the live definitions
-- and are schema-qualified. This migration changes only search_path; it does not alter
-- function bodies, grants, or financial behavior. Validate against a schema-matched
-- disposable database before deployment.
BEGIN;

ALTER FUNCTION public.cancel_p2p_trade(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.get_emergency_mode() SET search_path = '';
ALTER FUNCTION public.get_user_2fa_status(uuid) SET search_path = '';
ALTER FUNCTION public.initiate_didit_kyc(uuid, text) SET search_path = '';
ALTER FUNCTION public.mark_p2p_trade_paid(uuid, uuid, text) SET search_path = '';
ALTER FUNCTION public.raise_trade_dispute(uuid, uuid, text) SET search_path = '';

COMMIT;
