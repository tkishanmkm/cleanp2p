-- Durable, atomic user 2FA rate limiting across all web instances.
-- Only service_role can inspect or mutate attempt counters.
-- Local candidate only; validate on a disposable schema-faithful database.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_2fa_rate_limits (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_2fa_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_2fa_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_2fa_rate_limits TO service_role;

DROP POLICY IF EXISTS user_2fa_rate_limits_service_access ON public.user_2fa_rate_limits;
CREATE POLICY user_2fa_rate_limits_service_access
  ON public.user_2fa_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.check_user_2fa_rate_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_started_at TIMESTAMPTZ;
  v_failures INTEGER;
  v_retry_after INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required.' USING ERRCODE = '22023';
  END IF;

  -- Reserve this attempt atomically before credential verification.
  INSERT INTO public.user_2fa_rate_limits AS current_limit
    (user_id, window_started_at, failures, updated_at)
  VALUES (p_user_id, v_now, 1, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET window_started_at = CASE
          WHEN current_limit.window_started_at <= v_now - INTERVAL '15 minutes' THEN v_now
          ELSE current_limit.window_started_at
        END,
        failures = CASE
          WHEN current_limit.window_started_at <= v_now - INTERVAL '15 minutes' THEN 1
          ELSE LEAST(current_limit.failures + 1, 2147483647)
        END,
        updated_at = v_now
  RETURNING window_started_at, failures INTO v_started_at, v_failures;

  v_retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_started_at + INTERVAL '15 minutes' - v_now)))::INTEGER);
  RETURN jsonb_build_object(
    'allowed', v_failures <= 5,
    'remaining_attempts', GREATEST(0, 5 - v_failures),
    'retry_after_seconds', CASE WHEN v_failures > 5 THEN v_retry_after ELSE 0 END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.reset_user_2fa_rate_limit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.user_2fa_rate_limits WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows <= 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_user_2fa_rate_limit(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_user_2fa_rate_limit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_2fa_rate_limit(UUID) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.reset_user_2fa_rate_limit(UUID) TO service_role, postgres;

COMMIT;
