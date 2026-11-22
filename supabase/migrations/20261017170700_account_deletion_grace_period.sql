-- Account deletion grace period: lock access immediately, anonymize profile after 20 days.
-- Prepared locally only; validate with the project's profile triggers and cron before applying.
BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
    ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz,
    ADD COLUMN IF NOT EXISTS deletion_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_due_deletion
    ON public.profiles (deletion_scheduled_for)
    WHERE account_status = 'DELETION_PENDING'
      AND deletion_scheduled_for IS NOT NULL
      AND deletion_completed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.account_deletion_cleanup_queue (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    b2_cleanup_required boolean NOT NULL DEFAULT false,
    avatar_url text,
    photo_url text,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    last_error text
);
ALTER TABLE public.account_deletion_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_cleanup_queue TO service_role, postgres;

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
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.deactivate_ads_for_account_deletion() FROM PUBLIC, anon, authenticated;
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
    -- The existing profile protection trigger explicitly trusts the service-role JWT claim.
    -- Only postgres/ service_role can execute this function; ordinary users cannot set this claim via an exposed RPC.
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);

    INSERT INTO public.account_deletion_cleanup_queue (user_id, b2_cleanup_required, avatar_url, photo_url)
    SELECT p.id,
           (COALESCE(p.avatar_url, '') LIKE '/api/media/avatar/%'
            OR COALESCE(p.photo_url, '') LIKE '/api/media/avatar/%'
            OR COALESCE(p.avatar_url, '') ILIKE '%backblazeb2.com%'
            OR COALESCE(p.photo_url, '') ILIKE '%backblazeb2.com%'),
           p.avatar_url,
           p.photo_url
    FROM public.profiles p
    WHERE p.account_status = 'DELETION_PENDING'
      AND p.deletion_scheduled_for IS NOT NULL
      AND p.deletion_scheduled_for <= NOW()
      AND p.deletion_completed_at IS NULL
    ON CONFLICT (user_id) DO NOTHING;

    WITH due_profiles AS (
        SELECT p.id
        FROM public.profiles p
        WHERE p.account_status = 'DELETION_PENDING'
          AND p.deletion_scheduled_for IS NOT NULL
          AND p.deletion_scheduled_for <= NOW()
          AND p.deletion_completed_at IS NULL
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.profiles p
    SET
        status = 'deleted'::public.user_status_enum,
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
        deletion_completed_at = NOW(),
        updated_at = NOW()
    FROM due_profiles d
    WHERE p.id = d.id;

    GET DIAGNOSTICS v_anonymized_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'profiles_anonymized', v_anonymized_count,
        'completed_at', NOW()
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_due_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_account_deletions() TO service_role, postgres;

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
    FROM vault.decrypted_secrets s
    WHERE s.name = 'paxones_app_url'
    LIMIT 1;

    SELECT s.decrypted_secret INTO v_cron_secret
    FROM vault.decrypted_secrets s
    WHERE s.name = 'paxones_cron_secret'
    LIMIT 1;

    IF COALESCE(v_app_url, '') = '' OR COALESCE(v_cron_secret, '') = '' THEN
        RAISE WARNING 'Account-deletion media cleanup is not configured; set paxones_app_url and paxones_cron_secret in Supabase Vault.';
        RETURN;
    END IF;

    IF v_app_url !~ '^https://[^/?#]+/?$' THEN
        RAISE WARNING 'Account-deletion media cleanup URL must be an HTTPS origin without a path or query string.';
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

REVOKE ALL ON FUNCTION public.invoke_account_deletion_media_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_account_deletion_media_cleanup() TO service_role, postgres;

DO $schedule$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'paxones-finalize-account-deletions'
    ) THEN
        PERFORM cron.schedule(
            'paxones-finalize-account-deletions',
            '47 3 * * *',
            'SELECT public.finalize_due_account_deletions();'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'paxones-account-deletion-media-cleanup'
    ) THEN
        PERFORM cron.schedule(
            'paxones-account-deletion-media-cleanup',
            '17 4 * * *',
            'SELECT public.invoke_account_deletion_media_cleanup();'
        );
    END IF;
END;
$schedule$;

COMMIT;
