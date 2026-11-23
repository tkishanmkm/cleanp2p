-- Paxones production-contract alignment: confirmation scheduling and safe
-- public reads for the three non-secret platform access-control flags.
-- Source-control this migration; review and apply through the normal approved
-- migration process after schema-history reconciliation. Do not run ad hoc.

BEGIN;

ALTER TABLE public.onchain_withdrawals
  ADD COLUMN IF NOT EXISTS next_confirmation_check_at timestamptz
  NOT NULL DEFAULT pg_catalog.clock_timestamp();

CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_confirmation_due
  ON public.onchain_withdrawals (next_confirmation_check_at, created_at, id)
  WHERE status IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST');

CREATE OR REPLACE FUNCTION public.schedule_withdrawal_confirmation_check(
  p_withdrawal_id uuid,
  p_tx_hash text,
  p_next_check_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required to schedule withdrawal confirmation checks'
      USING ERRCODE = '42501';
  END IF;

  IF p_withdrawal_id IS NULL
     OR nullif(pg_catalog.btrim(coalesce(p_tx_hash, '')), '') IS NULL
     OR p_next_check_at IS NULL
     OR p_next_check_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'Invalid withdrawal confirmation schedule payload'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.onchain_withdrawals
  SET next_confirmation_check_at = p_next_check_at
  WHERE id = p_withdrawal_id
    AND lower(tx_hash) = lower(pg_catalog.btrim(p_tx_hash))
    AND status IN ('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST');

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.schedule_withdrawal_confirmation_check(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_withdrawal_confirmation_check(uuid, text, timestamptz)
  TO service_role, postgres;

-- The browser middleware must read only these non-secret control flags. The
-- underlying system_settings table remains private and has no client table grant.
CREATE OR REPLACE FUNCTION public.get_public_platform_control_flags()
RETURNS TABLE(key text, value jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT s.key, s.value
  FROM public.system_settings AS s
  WHERE s.key IN ('emergency_mode', 'maintenance_mode', 'prevent_user_login');
$function$;

REVOKE ALL ON FUNCTION public.get_public_platform_control_flags()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_platform_control_flags()
  TO anon, authenticated, service_role;

COMMIT;
