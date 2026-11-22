-- Enforce a maximum of 10 active ads per user across canonical and legacy ad tables.
-- Prepared locally only; validate against an isolated PostgreSQL/Supabase schema before applying.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_user_active_ad_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_active_count bigint := 0;
    v_new_is_active boolean := false;
    v_account_status text;
    v_profile_status text;
    v_is_banned boolean := false;
    v_is_restricted boolean := false;
    v_is_suspended boolean := false;
BEGIN
    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'Advertisement owner is required.'
            USING ERRCODE = '23502';
    END IF;

    IF COALESCE(NEW.is_deleted, false)
       OR UPPER(COALESCE(NEW.status, '')) = 'DELETED' THEN
        RETURN NEW;
    END IF;

    v_new_is_active :=
        COALESCE(NEW.active, false)
        OR COALESCE(NEW.is_active, false)
        OR LOWER(COALESCE(NEW.status, '')) IN ('active', 'published');

    IF NOT v_new_is_active THEN
        RETURN NEW;
    END IF;

    -- A public ID may be mirrored once into the other table for compatibility, but it
    -- cannot be reused for a second row in the same table or another owner's ad.
    IF NULLIF(NEW.public_ad_id, '') IS NOT NULL THEN
        IF TG_TABLE_NAME = 'ads' AND EXISTS (
            SELECT 1 FROM public.ads a
            WHERE a.public_ad_id = NEW.public_ad_id
              AND (TG_OP <> 'UPDATE' OR a.id::text <> NEW.id::text)
        ) THEN
            RAISE EXCEPTION 'Advertisement public ID already exists.' USING ERRCODE = '23505';
        END IF;
        IF TG_TABLE_NAME = 'p2p_ads' AND EXISTS (
            SELECT 1 FROM public.p2p_ads p
            WHERE p.public_ad_id = NEW.public_ad_id
              AND (TG_OP <> 'UPDATE' OR p.id::text <> NEW.id::text)
        ) THEN
            RAISE EXCEPTION 'Advertisement public ID already exists.' USING ERRCODE = '23505';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public.ads a
            WHERE a.public_ad_id = NEW.public_ad_id AND a.user_id <> NEW.user_id
            UNION ALL
            SELECT 1 FROM public.p2p_ads p
            WHERE p.public_ad_id = NEW.public_ad_id AND p.user_id <> NEW.user_id
        ) THEN
            RAISE EXCEPTION 'Advertisement public ID is already assigned to another owner.' USING ERRCODE = '23505';
        END IF;
    END IF;

    -- Serialize ad activation for one user across both tables, preventing race-condition bypasses.
    SELECT p.account_status, p.status::text, COALESCE(p.is_banned, false),
           COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false)
    INTO v_account_status, v_profile_status, v_is_banned, v_is_restricted, v_is_suspended
    FROM public.profiles p
    WHERE p.id = NEW.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'A valid user profile is required to publish an advertisement.'
            USING ERRCODE = '23503';
    END IF;

    IF COALESCE(v_is_banned, false) OR COALESCE(v_is_restricted, false) OR COALESCE(v_is_suspended, false)
       OR LOWER(COALESCE(v_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
       OR UPPER(COALESCE(v_account_status, '')) IN ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
        RAISE EXCEPTION 'This account is not allowed to publish active advertisements.'
            USING ERRCODE = '42501', DETAIL = 'ACCOUNT_AD_ACCESS_BLOCKED';
    END IF;

    SELECT COUNT(DISTINCT active_ads.ad_key)
    INTO v_active_count
    FROM (
        SELECT COALESCE(NULLIF(a.public_ad_id, ''), 'ads:' || a.id) AS ad_key
        FROM public.ads a
        WHERE a.user_id = NEW.user_id
          AND NOT COALESCE(a.is_deleted, false)
          AND UPPER(COALESCE(a.status, '')) <> 'DELETED'
          AND (
              COALESCE(a.active, false)
              OR COALESCE(a.is_active, false)
              OR LOWER(COALESCE(a.status, '')) IN ('active', 'published')
          )
          AND NOT (
              (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ads' AND a.id::text = NEW.id::text)
              OR (NULLIF(NEW.public_ad_id, '') IS NOT NULL AND a.public_ad_id = NEW.public_ad_id)
          )

        UNION ALL

        SELECT COALESCE(NULLIF(p.public_ad_id, ''), 'p2p_ads:' || p.id::text) AS ad_key
        FROM public.p2p_ads p
        WHERE p.user_id = NEW.user_id
          AND NOT COALESCE(p.is_deleted, false)
          AND UPPER(COALESCE(p.status, '')) <> 'DELETED'
          AND (
              COALESCE(p.active, false)
              OR COALESCE(p.is_active, false)
              OR LOWER(COALESCE(p.status, '')) IN ('active', 'published')
          )
          AND NOT (
              (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'p2p_ads' AND p.id::text = NEW.id::text)
              OR (NULLIF(NEW.public_ad_id, '') IS NOT NULL AND p.public_ad_id = NEW.public_ad_id)
          )
    ) AS active_ads;

    IF v_active_count >= 10 THEN
        RAISE EXCEPTION 'You have reached the maximum of 10 active advertisements.'
            USING ERRCODE = 'P0001',
                  DETAIL = 'USER_AD_LIMIT_REACHED';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_user_active_ad_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_user_active_ad_limit_ads_insert ON public.ads;
CREATE TRIGGER enforce_user_active_ad_limit_ads_insert
BEFORE INSERT ON public.ads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_active_ad_limit();

DROP TRIGGER IF EXISTS enforce_user_active_ad_limit_ads_update ON public.ads;
CREATE TRIGGER enforce_user_active_ad_limit_ads_update
BEFORE UPDATE OF user_id, active, is_active, is_deleted, status, public_ad_id ON public.ads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_active_ad_limit();

DROP TRIGGER IF EXISTS enforce_user_active_ad_limit_p2p_ads_insert ON public.p2p_ads;
CREATE TRIGGER enforce_user_active_ad_limit_p2p_ads_insert
BEFORE INSERT ON public.p2p_ads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_active_ad_limit();

DROP TRIGGER IF EXISTS enforce_user_active_ad_limit_p2p_ads_update ON public.p2p_ads;
CREATE TRIGGER enforce_user_active_ad_limit_p2p_ads_update
BEFORE UPDATE OF user_id, active, is_active, is_deleted, status, public_ad_id ON public.p2p_ads
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_active_ad_limit();

COMMIT;
