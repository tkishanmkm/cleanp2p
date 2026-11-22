-- Atomic per-sender, per-trade attachment quotas across both supported upload routes.
-- Local migration only: validate on an isolated schema before applying to any shared database.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_trade_media_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_trade_id text;
    v_sender_id text;
    v_media_type text;
    v_count bigint := 0;
    v_is_external boolean := false;
BEGIN
    IF TG_TABLE_NAME = 'trade_files' THEN
        v_trade_id := NEW.trade_id::text;
        v_sender_id := NEW.uploaded_by::text;
        v_media_type := LOWER(COALESCE(NEW.file_type, ''));
        v_is_external := COALESCE(NEW.is_external_link, false);

        IF v_is_external OR v_media_type NOT IN ('image', 'document', 'video') THEN
            RETURN NEW;
        END IF;
    ELSIF TG_TABLE_NAME = 'trade_messages' THEN
        v_trade_id := NEW.trade_id::text;
        v_sender_id := NEW.sender_id::text;
        v_media_type := LOWER(COALESCE(NEW.media_type, ''));

        -- Ordinary text messages and cloud-link messages do not consume binary quotas.
        IF NEW.media_url IS NULL OR v_media_type NOT IN ('image', 'document', 'video') THEN
            RETURN NEW;
        END IF;
    ELSE
        RETURN NEW;
    END IF;

    IF v_trade_id IS NULL OR v_sender_id IS NULL THEN
        RAISE EXCEPTION 'Trade attachment owner and trade are required.'
            USING ERRCODE = '23502';
    END IF;

    -- Shared lock key prevents simultaneous inserts through either upload route racing past the cap.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('paxones-trade-media:' || v_trade_id || ':' || v_sender_id || ':' || v_media_type, 0)
    );

    -- Count unique physical objects, not the larger of two table counts.
    -- The newer upload path stores the B2 object key in media_url as
    -- /api/trade/media?key=<URL-encoded object key>; the legacy path stores it
    -- directly in trade_files.object_key. A UNION deduplicates mirrored rows
    -- while still counting distinct uploads split across the two tables.
    SELECT COUNT(DISTINCT attachment_identity)
    INTO v_count
    FROM (
        SELECT
            CASE
                WHEN NULLIF(BTRIM(f.object_key), '') IS NOT NULL
                    THEN 'object:' || f.object_key
                ELSE 'file-row:' || f.id::text
            END AS attachment_identity
        FROM public.trade_files f
        WHERE f.trade_id::text = v_trade_id
          AND f.uploaded_by::text = v_sender_id
          AND LOWER(COALESCE(f.file_type, '')) = v_media_type
          AND NOT COALESCE(f.is_external_link, false)
          AND NOT (TG_TABLE_NAME = 'trade_files' AND TG_OP = 'UPDATE' AND f.id::text = NEW.id::text)

        UNION ALL

        SELECT
            CASE
                WHEN POSITION('key=' IN m.media_url) > 0
                     AND NULLIF(SPLIT_PART(SPLIT_PART(m.media_url, 'key=', 2), '&', 1), '') IS NOT NULL
                    THEN 'object:' || REGEXP_REPLACE(
                        SPLIT_PART(SPLIT_PART(m.media_url, 'key=', 2), '&', 1),
                        '%2F', '/', 'gi'
                    )
                WHEN m.media_url LIKE 'trades/%'
                    THEN 'object:' || m.media_url
                ELSE 'message-row:' || m.id::text
            END AS attachment_identity
        FROM public.trade_messages m
        WHERE m.trade_id::text = v_trade_id
          AND m.sender_id::text = v_sender_id
          AND LOWER(COALESCE(m.media_type, '')) = v_media_type
          AND m.media_url IS NOT NULL
          AND NOT (TG_TABLE_NAME = 'trade_messages' AND TG_OP = 'UPDATE' AND m.id::text = NEW.id::text)
    ) AS attachment_rows;

    IF v_count >= 3 THEN
        RAISE EXCEPTION 'You have reached the limit of 3 %s attachments for this trade. Share additional files through Google Drive or Dropbox.', v_media_type
            USING ERRCODE = 'P0001',
                  DETAIL = 'TRADE_MEDIA_LIMIT_REACHED';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_trade_media_quota() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS c_enforce_trade_media_quota ON public.trade_files;
CREATE TRIGGER c_enforce_trade_media_quota
BEFORE INSERT OR UPDATE OF trade_id, uploaded_by, file_type, is_external_link
ON public.trade_files
FOR EACH ROW
EXECUTE FUNCTION public.enforce_trade_media_quota();

DROP TRIGGER IF EXISTS c_enforce_trade_media_quota ON public.trade_messages;
CREATE TRIGGER c_enforce_trade_media_quota
BEFORE INSERT OR UPDATE OF trade_id, sender_id, media_type, media_url
ON public.trade_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_trade_media_quota();

COMMIT;
