-- Track failed trade openings against offline advertisers.
-- Prepared locally only. Apply only after isolated migration tests and explicit approval.
BEGIN;

ALTER TABLE public.ads
  ADD COLUMN IF NOT EXISTS offline_open_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offline_open_last_at timestamptz;

ALTER TABLE public.p2p_ads
  ADD COLUMN IF NOT EXISTS offline_open_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offline_open_last_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ad_offline_open_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_key text NOT NULL,
  buyer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ad_key, buyer_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_ad_offline_open_attempts_created_at
  ON public.ad_offline_open_attempts (created_at);
ALTER TABLE public.ad_offline_open_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ad_offline_open_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ad_offline_open_attempts TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.record_ad_offline_open_attempt(
  p_ad_id text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_buyer_id uuid := auth.uid();
  v_owner_id uuid;
  v_public_ad_id text;
  v_selected_id text;
  v_ad_key text;
  v_ad_active boolean := false;
  v_owner_online boolean := false;
  v_last_seen timestamptz;
  v_is_online boolean := false;
  v_buyer_profile_status text;
  v_buyer_account_status text;
  v_buyer_is_banned boolean := false;
  v_buyer_is_restricted boolean := false;
  v_buyer_is_suspended boolean := false;
  v_attempts integer := 0;
  v_inserted_id uuid;
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to open a trade.'
      USING ERRCODE = '42501';
  END IF;
  IF COALESCE(length(btrim(p_ad_id)), 0) = 0
     OR COALESCE(length(btrim(p_idempotency_key)), 0) < 8
     OR length(p_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'Advertisement and valid idempotency key are required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.status::text, p.account_status, COALESCE(p.is_banned, false),
         COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false)
    INTO v_buyer_profile_status, v_buyer_account_status,
         v_buyer_is_banned, v_buyer_is_restricted, v_buyer_is_suspended
  FROM public.profiles p
  WHERE p.id = v_buyer_id;

  IF NOT FOUND
     OR COALESCE(v_buyer_is_banned, false)
     OR COALESCE(v_buyer_is_restricted, false)
     OR COALESCE(v_buyer_is_suspended, false)
     OR LOWER(COALESCE(v_buyer_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
     OR UPPER(COALESCE(v_buyer_account_status, '')) IN ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
    RAISE EXCEPTION 'This account is not allowed to initiate trade-opening attempts.'
      USING ERRCODE = '42501', DETAIL = 'ACCOUNT_AD_ACCESS_BLOCKED';
  END IF;

  -- Lock the ad record and resolve the same public ad across canonical and legacy tables.
  SELECT p.user_id, p.public_ad_id, p.id::text,
         (COALESCE(p.active, false) OR COALESCE(p.is_active, false)
          OR LOWER(COALESCE(p.status, '')) IN ('active', 'published'))
    INTO v_owner_id, v_public_ad_id, v_selected_id, v_ad_active
  FROM public.p2p_ads p
  WHERE p.id::text = p_ad_id OR p.public_ad_id = p_ad_id
  ORDER BY CASE WHEN p.id::text = p_ad_id THEN 0 ELSE 1 END
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    SELECT a.user_id, COALESCE(NULLIF(a.public_ad_id, ''), NULLIF(a.public_id, '')), a.id::text,
           (COALESCE(a.active, false) OR COALESCE(a.is_active, false)
            OR LOWER(COALESCE(a.status, '')) IN ('active', 'published'))
      INTO v_owner_id, v_public_ad_id, v_selected_id, v_ad_active
    FROM public.ads a
    WHERE a.id::text = p_ad_id OR a.public_ad_id = p_ad_id OR a.public_id = p_ad_id
    ORDER BY CASE WHEN a.id::text = p_ad_id THEN 0 ELSE 1 END
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF NOT FOUND OR v_owner_id IS NULL THEN
    RETURN jsonb_build_object('ad_found', false, 'seller_online', false);
  END IF;
  IF v_owner_id = v_buyer_id THEN
    RAISE EXCEPTION 'You cannot trade with your own advertisement.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT v_ad_active THEN
    RETURN jsonb_build_object('ad_found', true, 'ad_active', false, 'seller_online', false);
  END IF;

  v_ad_key := COALESCE(NULLIF(v_public_ad_id, ''), v_selected_id);

  PERFORM pg_advisory_xact_lock(hashtextextended('paxones-ad-offline:' || v_ad_key, 0));

  SELECT COALESCE(p.is_online, false), COALESCE(p.last_seen, p.last_seen_at)
    INTO v_is_online, v_last_seen
  FROM public.profiles p
  WHERE p.id = v_owner_id;

  -- Use the same 120-second freshness window as the UI presence indicator.
  -- The UI derives presence from the heartbeat timestamp; use the same source of truth
  -- instead of the potentially stale is_online flag.
  v_owner_online := v_last_seen IS NOT NULL
    AND v_last_seen >= now() - interval '120 seconds';

  IF v_owner_online THEN
    UPDATE public.ads
      SET offline_open_attempts = 0, offline_open_last_at = NULL
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id
             OR public_id = v_ad_key OR public_id = v_public_ad_id);
    UPDATE public.p2p_ads
      SET offline_open_attempts = 0, offline_open_last_at = NULL
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id);
    RETURN jsonb_build_object('ad_found', true, 'ad_active', true, 'seller_online', true, 'attempts', 0);
  END IF;

  -- One buyer contributes at most one offline attempt per ad every 15 minutes,
  -- limiting easy abuse by repeatedly submitting fresh idempotency keys.
  IF EXISTS (
    SELECT 1 FROM public.ad_offline_open_attempts e
    WHERE e.ad_key = v_ad_key
      AND e.buyer_id = v_buyer_id
      AND e.created_at > now() - interval '15 minutes'
  ) THEN
    SELECT GREATEST(
      COALESCE((SELECT MAX(a.offline_open_attempts) FROM public.ads a
        WHERE a.user_id = v_owner_id AND (a.id::text = v_selected_id OR a.public_ad_id = v_ad_key OR a.public_ad_id = v_public_ad_id OR a.public_id = v_ad_key OR a.public_id = v_public_ad_id)), 0),
      COALESCE((SELECT MAX(p.offline_open_attempts) FROM public.p2p_ads p
        WHERE p.user_id = v_owner_id AND (p.id::text = v_selected_id OR p.public_ad_id = v_ad_key OR p.public_ad_id = v_public_ad_id)), 0)
    ) INTO v_attempts;
    RETURN jsonb_build_object('ad_found', true, 'ad_active', true, 'seller_online', false, 'attempts', v_attempts, 'deactivated', false);
  END IF;

  INSERT INTO public.ad_offline_open_attempts (ad_key, buyer_id, idempotency_key)
  VALUES (v_ad_key, v_buyer_id, btrim(p_idempotency_key))
  ON CONFLICT (ad_key, buyer_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_inserted_id;

  SELECT GREATEST(
    COALESCE((SELECT MAX(a.offline_open_attempts) FROM public.ads a
      WHERE a.user_id = v_owner_id AND (a.id::text = v_selected_id OR a.public_ad_id = v_ad_key OR a.public_ad_id = v_public_ad_id OR a.public_id = v_ad_key OR a.public_id = v_public_ad_id)), 0),
    COALESCE((SELECT MAX(p.offline_open_attempts) FROM public.p2p_ads p
      WHERE p.user_id = v_owner_id AND (p.id::text = v_selected_id OR p.public_ad_id = v_ad_key OR p.public_ad_id = v_public_ad_id)), 0)
  ) INTO v_attempts;

  IF v_inserted_id IS NOT NULL THEN
    v_attempts := v_attempts + 1;
    UPDATE public.ads
      SET offline_open_attempts = v_attempts, offline_open_last_at = now()
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id
             OR public_id = v_ad_key OR public_id = v_public_ad_id);
    UPDATE public.p2p_ads
      SET offline_open_attempts = v_attempts, offline_open_last_at = now()
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id);
  END IF;

  IF v_attempts >= 3 THEN
    UPDATE public.ads
      SET active = false, is_active = false, status = 'paused'
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id
             OR public_id = v_ad_key OR public_id = v_public_ad_id);
    UPDATE public.p2p_ads
      SET active = false, is_active = false, status = 'paused'
      WHERE user_id = v_owner_id
        AND (id::text = v_selected_id OR public_ad_id = v_ad_key OR public_ad_id = v_public_ad_id);

    BEGIN
      INSERT INTO public.notifications (user_id, title, message, type, read, is_read, metadata)
      VALUES (
        v_owner_id,
        'Advertisement paused because you were offline',
        'Your advertisement was automatically paused after three trade-opening attempts while your account appeared offline. Open the advertisement settings to reactivate it when you are available.',
        'warning',
        false,
        false,
        jsonb_build_object('code', 'AD_AUTO_PAUSED_OFFLINE', 'ad_id', v_ad_key, 'offline_attempts', v_attempts)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Advertisement was paused, but its notification could not be inserted.';
    END;

    RETURN jsonb_build_object('ad_found', true, 'ad_active', false, 'seller_online', false, 'attempts', v_attempts, 'deactivated', true);
  END IF;

  RETURN jsonb_build_object('ad_found', true, 'ad_active', true, 'seller_online', false, 'attempts', v_attempts, 'deactivated', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.record_ad_offline_open_attempt(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_ad_offline_open_attempt(text, text) TO authenticated, service_role;

-- Direct RPC calls cannot bypass the offline-owner trade-opening guard.
CREATE OR REPLACE FUNCTION public.guard_trade_seller_online()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ad_owner_id uuid;
  v_is_online boolean := false;
  v_last_seen timestamptz;
  v_is_service_role boolean :=
    COALESCE(auth.role() = 'service_role', false)
    OR COALESCE(current_setting('role', true) = 'service_role', false);
BEGIN
  IF v_is_service_role THEN
    RETURN NEW;
  END IF;

  -- Resolve by canonical public.ads first, then legacy public.p2p_ads.
  -- A trade may retain a legacy UUID in ad_id even after public ads are canonicalized.
  -- Do not infer ownership from NEW.seller_id: for BUY ads the initiator may be seller.
  SELECT a.user_id
    INTO v_ad_owner_id
  FROM public.ads a
  WHERE a.id::text = COALESCE(NEW.ad_id::text, '')
     OR (NULLIF(NEW.public_ad_id::text, '') IS NOT NULL
         AND (a.public_ad_id = NEW.public_ad_id::text
              OR a.public_id = NEW.public_ad_id::text))
     OR (NULLIF(NEW.ad_id::text, '') IS NOT NULL
         AND (a.public_ad_id = NEW.ad_id::text OR a.public_id = NEW.ad_id::text))
  ORDER BY CASE WHEN a.id::text = COALESCE(NEW.ad_id::text, '') THEN 0 ELSE 1 END
  LIMIT 1;

  IF NOT FOUND OR v_ad_owner_id IS NULL THEN
    SELECT p.user_id
      INTO v_ad_owner_id
    FROM public.p2p_ads p
    WHERE p.id::text = COALESCE(NEW.ad_id::text, '')
       OR (NULLIF(NEW.public_ad_id::text, '') IS NOT NULL
           AND p.public_ad_id = NEW.public_ad_id::text)
       OR (NULLIF(NEW.ad_id::text, '') IS NOT NULL
           AND p.public_ad_id = NEW.ad_id::text)
    ORDER BY CASE WHEN p.id::text = COALESCE(NEW.ad_id::text, '') THEN 0 ELSE 1 END
    LIMIT 1;
  END IF;

  IF NOT FOUND OR v_ad_owner_id IS NULL THEN
    RAISE EXCEPTION 'The advertisement owner could not be verified.'
      USING ERRCODE = '42501', DETAIL = 'AD_OWNER_UNAVAILABLE';
  END IF;

  SELECT COALESCE(p.is_online, false), COALESCE(p.last_seen, p.last_seen_at)
    INTO v_is_online, v_last_seen
  FROM public.profiles p
  WHERE p.id = v_ad_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The advertisement owner profile could not be verified.'
      USING ERRCODE = '42501', DETAIL = 'AD_OWNER_UNAVAILABLE';
  END IF;

  IF v_last_seen IS NULL
     OR v_last_seen < now() - interval '120 seconds' THEN
    RAISE EXCEPTION 'The advertisement owner is currently offline. Please try again later.'
      USING ERRCODE = 'P0001', DETAIL = 'AD_OWNER_OFFLINE';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_trade_seller_online() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_trade_seller_online ON public.trades;
CREATE TRIGGER guard_trade_seller_online
BEFORE INSERT ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.guard_trade_seller_online();

DO $schedule$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'paxones-ad-offline-attempt-retention') THEN
    PERFORM cron.schedule(
      'paxones-ad-offline-attempt-retention',
      '29 3 * * *',
      'DELETE FROM public.ad_offline_open_attempts WHERE created_at < NOW() - INTERVAL ''30 days'';'
    );
  END IF;
END;
$schedule$;

COMMIT;
