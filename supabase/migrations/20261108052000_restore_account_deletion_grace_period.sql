-- Restore the 20-day account-deletion workflow.
-- The finalizer fails closed until the media-cleanup Vault secrets exist.
-- Media cleanup scheduling is intentionally deferred until those secrets and
-- the deployed CRON_SECRET are configured and matched.
BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_due_deletion_idx
  ON public.profiles (deletion_scheduled_for)
  WHERE account_status = 'DELETION_PENDING'
    AND deletion_scheduled_for IS NOT NULL
    AND deletion_completed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup_queue (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  b2_cleanup_required boolean NOT NULL DEFAULT false,
  avatar_url text,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);

ALTER TABLE public.account_deletion_cleanup_queue OWNER TO postgres;
ALTER TABLE public.account_deletion_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_cleanup_queue
  FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_cleanup_queue
  TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.deactivate_ads_for_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF UPPER(COALESCE(NEW.account_status, '')) IN ('DELETION_PENDING', 'DELETED') THEN
    UPDATE public.ads
       SET active = false, is_active = false, status = 'PAUSED'
     WHERE user_id = NEW.id;

    UPDATE public.p2p_ads
       SET active = false, is_active = false, status = 'PAUSED'
     WHERE user_id = NEW.id;

    UPDATE public.advertisements
       SET is_active = false
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.deactivate_ads_for_account_deletion() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.deactivate_ads_for_account_deletion()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
DROP TRIGGER IF EXISTS deactivate_ads_for_account_deletion ON public.profiles;
CREATE TRIGGER deactivate_ads_for_account_deletion
  AFTER UPDATE OF account_status ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.deactivate_ads_for_account_deletion();

CREATE OR REPLACE FUNCTION public.finalize_due_account_deletions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_anonymized_count bigint := 0;
BEGIN
  -- Prevent overlapping runs from queueing/deleting the same users concurrently.
  PERFORM pg_advisory_xact_lock(2070110805, 1);

  -- Do not erase profile data until the media-cleanup endpoint is configured.
  -- Missing secrets keep due requests locked/pending for a later retry.
  IF NOT EXISTS (
       SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paxones_app_url'
     )
     OR NOT EXISTS (
       SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paxones_cron_secret'
     ) THEN
    RETURN jsonb_build_object(
      'profiles_anonymized', 0,
      'blocked', true,
      'reason', 'Account-deletion media cleanup is not configured.',
      'checked_at', clock_timestamp()
    );
  END IF;

  -- The deployed profile protection trigger permits service-role claims only.
  -- This function remains postgres-only; the claim is transaction-local.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.account_deletion_cleanup_queue (
    user_id, b2_cleanup_required, avatar_url, photo_url
  )
  SELECT
    p.id,
    (
      COALESCE(p.avatar_url, '') LIKE '/api/media/avatar/%'
      OR COALESCE(p.photo_url, '') LIKE '/api/media/avatar/%'
      OR COALESCE(p.avatar_url, '') ILIKE '%backblazeb2.com%'
      OR COALESCE(p.photo_url, '') ILIKE '%backblazeb2.com%'
    ),
    p.avatar_url,
    p.photo_url
  FROM public.profiles AS p
  WHERE p.account_status = 'DELETION_PENDING'
    AND p.deletion_scheduled_for IS NOT NULL
    AND p.deletion_scheduled_for <= clock_timestamp()
    AND p.deletion_completed_at IS NULL
  ON CONFLICT (user_id) DO NOTHING;

  WITH due_profiles AS (
    SELECT p.id
    FROM public.profiles AS p
    WHERE p.account_status = 'DELETION_PENDING'
      AND p.deletion_scheduled_for IS NOT NULL
      AND p.deletion_scheduled_for <= clock_timestamp()
      AND p.deletion_completed_at IS NULL
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.profiles AS p
     SET status = 'deleted'::public.user_status_enum,
         account_status = 'DELETED',
         is_suspended = true,
         full_name = NULL,
         name = NULL,
         display_name = 'Deleted Account',
         photo_url = NULL,
         avatar_url = NULL,
         dob = NULL,
         date_of_birth = NULL,
         email = NULL,
         country = NULL,
         is_online = false,
         last_seen_at = NULL,
         deletion_completed_at = clock_timestamp(),
         updated_at = clock_timestamp()
    FROM due_profiles AS d
   WHERE p.id = d.id;

  GET DIAGNOSTICS v_anonymized_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'profiles_anonymized', v_anonymized_count,
    'blocked', false,
    'completed_at', clock_timestamp()
  );
END;
$function$;

ALTER FUNCTION public.finalize_due_account_deletions() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_due_account_deletions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.finalize_due_account_deletions() TO postgres;

CREATE OR REPLACE FUNCTION public.invoke_account_deletion_media_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_app_url text;
  v_cron_secret text;
BEGIN
  SELECT s.decrypted_secret INTO v_app_url
    FROM vault.decrypted_secrets AS s
   WHERE s.name = 'paxones_app_url'
   LIMIT 1;

  SELECT s.decrypted_secret INTO v_cron_secret
    FROM vault.decrypted_secrets AS s
   WHERE s.name = 'paxones_cron_secret'
   LIMIT 1;

  IF COALESCE(v_app_url, '') = '' OR COALESCE(v_cron_secret, '') = '' THEN
    RAISE WARNING 'Account-deletion media cleanup is not configured in Supabase Vault.';
    RETURN;
  END IF;

  IF v_app_url !~ '^https://[^/?#]+/?$' THEN
    RAISE WARNING 'Account-deletion app URL must be an HTTPS origin without a path or query string.';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_app_url, '/') || '/api/cron/process-account-deletion-cleanup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
END;
$function$;

ALTER FUNCTION public.invoke_account_deletion_media_cleanup() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.invoke_account_deletion_media_cleanup()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.invoke_account_deletion_media_cleanup() TO postgres;

-- Only the database finalizer is scheduled now. The finalizer is postgres-only
-- and fails closed until both required Vault secrets are present.
DO $schedule$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'paxones-finalize-account-deletions'
  ) THEN
    PERFORM cron.schedule(
      'paxones-finalize-account-deletions',
      '47 3 * * *',
      'SELECT public.finalize_due_account_deletions();'
    );
  END IF;
END;
$schedule$;

-- Run only after paxones_app_url and paxones_cron_secret are stored in Vault,
-- and the latter matches the deployed application's CRON_SECRET:
-- SELECT public.schedule_account_deletion_media_cleanup();

CREATE OR REPLACE FUNCTION public.schedule_account_deletion_media_cleanup()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job_id bigint;
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paxones_app_url'
     )
     OR NOT EXISTS (
       SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paxones_cron_secret'
     ) THEN
    RAISE EXCEPTION 'Configure paxones_app_url and paxones_cron_secret in Supabase Vault first.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'paxones-account-deletion-media-cleanup'
  ) THEN
    SELECT jobid INTO v_job_id
      FROM cron.job
     WHERE jobname = 'paxones-account-deletion-media-cleanup'
     LIMIT 1;
    RETURN v_job_id;
  END IF;

  SELECT cron.schedule(
    'paxones-account-deletion-media-cleanup',
    '17 4 * * *',
    'SELECT public.invoke_account_deletion_media_cleanup();'
  ) INTO v_job_id;

  RETURN v_job_id;
END;
$function$;

ALTER FUNCTION public.schedule_account_deletion_media_cleanup() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.schedule_account_deletion_media_cleanup()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.schedule_account_deletion_media_cleanup() TO postgres;

COMMIT;
