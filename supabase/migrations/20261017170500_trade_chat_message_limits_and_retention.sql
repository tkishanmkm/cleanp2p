-- Trade chat message caps, sender integrity, and 30-day retention.
-- Prepared locally only. Validate against an isolated database before applying.
BEGIN;

-- Match notification retention/list queries to user scope and descending time order.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created_at
    ON public.notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.guard_trade_messages_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_username text;
    v_role text;
    v_is_admin boolean := false;
    v_is_admin_account boolean := false;
    v_profile_status text;
    v_account_status text;
    v_is_banned boolean := false;
    v_is_restricted boolean := false;
    v_is_suspended boolean := false;
    v_is_service_role boolean :=
        COALESCE(auth.role() = 'service_role', false)
        OR COALESCE(current_setting('role', true) = 'service_role', false);
BEGIN
    IF v_is_service_role THEN
        RETURN NEW;
    END IF;

    IF v_uid IS NULL OR NEW.sender_id::text IS DISTINCT FROM v_uid::text THEN
        RAISE EXCEPTION 'Chat sender identity does not match the authenticated user.'
            USING ERRCODE = '42501';
    END IF;

    SELECT p.username, p.role::text, COALESCE(p.is_admin, false), COALESCE(p.is_admin_account, false),
           p.status::text, p.account_status, COALESCE(p.is_banned, false), COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false)
    INTO v_username, v_role, v_is_admin, v_is_admin_account,
         v_profile_status, v_account_status, v_is_banned, v_is_restricted, v_is_suspended
    FROM public.profiles p
    WHERE p.id = v_uid;

    IF COALESCE(v_is_banned, false) OR COALESCE(v_is_restricted, false) OR COALESCE(v_is_suspended, false)
       OR LOWER(COALESCE(v_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
       OR UPPER(COALESCE(v_account_status, '')) IN ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
        RAISE EXCEPTION 'This account cannot send trade messages because access is disabled.'
            USING ERRCODE = '42501', DETAIL = 'ACCOUNT_ACCESS_BLOCKED';
    END IF;

    IF NOT (COALESCE(v_is_admin, false)
        OR COALESCE(v_is_admin_account, false)
        OR LOWER(COALESCE(v_role, '')) IN ('admin', 'moderator'))
       AND NOT EXISTS (
           SELECT 1
           FROM public.trades t
           WHERE (t.id::text = NEW.trade_id OR t.trade_id = NEW.trade_id)
             AND (t.buyer_id = v_uid::text OR t.seller_id = v_uid::text)
       ) THEN
        RAISE EXCEPTION 'Only trade participants may send messages to this trade.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_trade_messages_sender() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_guard_trade_messages_sender ON public.trade_messages;
CREATE TRIGGER a_guard_trade_messages_sender
BEFORE INSERT ON public.trade_messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_trade_messages_sender();


CREATE OR REPLACE FUNCTION public.enforce_trade_chat_message_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid uuid := auth.uid();
    v_trade_id text := NEW.trade_id::text;
    v_canonical_trade_id text := NEW.trade_id::text;
    v_public_trade_id text;
    v_sender_id text := NEW.sender_id::text;
    v_message_count bigint;
    v_other_message_count bigint := 0;
    v_is_service_role boolean :=
        COALESCE(auth.role() = 'service_role', false)
        OR COALESCE(current_setting('role', true) = 'service_role', false);
    v_is_admin boolean := false;
    v_is_admin_account boolean := false;
    v_role text;
    v_profile_status text;
    v_account_status text;
    v_is_banned boolean := false;
    v_is_restricted boolean := false;
    v_is_suspended boolean := false;
    v_trade_status text;
BEGIN
    IF NOT v_is_service_role THEN
        IF v_uid IS NULL OR v_sender_id IS DISTINCT FROM v_uid::text THEN
            RAISE EXCEPTION 'Chat sender identity does not match the authenticated user.'
                USING ERRCODE = '42501';
        END IF;

        SELECT COALESCE(p.is_admin, false), COALESCE(p.is_admin_account, false), p.role::text,
               p.status::text, p.account_status, COALESCE(p.is_banned, false), COALESCE(p.is_restricted, false), COALESCE(p.is_suspended, false)
        INTO v_is_admin, v_is_admin_account, v_role,
             v_profile_status, v_account_status, v_is_banned, v_is_restricted, v_is_suspended
        FROM public.profiles p
        WHERE p.id = v_uid;

        IF COALESCE(v_is_banned, false) OR COALESCE(v_is_restricted, false) OR COALESCE(v_is_suspended, false)
           OR LOWER(COALESCE(v_profile_status, '')) IN ('banned', 'restricted', 'suspended', 'deleted')
           OR UPPER(COALESCE(v_account_status, '')) IN ('BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETION_PENDING', 'DELETED') THEN
            RAISE EXCEPTION 'This account cannot send trade messages because access is disabled.'
                USING ERRCODE = '42501', DETAIL = 'ACCOUNT_ACCESS_BLOCKED';
        END IF;

        SELECT LOWER(COALESCE(t.status::text, ''))
        INTO v_trade_status
        FROM public.trades t
        WHERE t.id::text = v_trade_id OR t.trade_id = v_trade_id;

        IF v_trade_status IN ('completed', 'released', 'cancelled', 'canceled', 'expired')
           AND NOT (COALESCE(v_is_admin, false)
               OR COALESCE(v_is_admin_account, false)
               OR LOWER(COALESCE(v_role, '')) IN ('admin', 'moderator')) THEN
            RAISE EXCEPTION 'Trade chat is closed after the trade has completed or been cancelled.'
                USING ERRCODE = 'P0001', DETAIL = 'TRADE_CHAT_CLOSED';
        END IF;

        IF NOT (COALESCE(v_is_admin, false)
            OR COALESCE(v_is_admin_account, false)
            OR LOWER(COALESCE(v_role, '')) IN ('admin', 'moderator'))
           AND NOT EXISTS (
               SELECT 1
               FROM public.trades t
               WHERE (t.id::text = v_trade_id OR t.trade_id = v_trade_id)
                 AND (t.buyer_id = v_uid::text OR t.seller_id = v_uid::text)
           ) THEN
            RAISE EXCEPTION 'Only trade participants may send messages to this trade.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- System lifecycle messages do not consume the human chat allowance.
    IF v_sender_id = '00000000-0000-0000-0000-000000000000' THEN
        RETURN NEW;
    END IF;

    -- Normalize UUID and public trade identifiers to one lock key and count both aliases.
    -- This prevents a participant switching identifier formats to bypass the per-trade cap.
    SELECT t.id::text, t.trade_id::text
    INTO v_canonical_trade_id, v_public_trade_id
    FROM public.trades t
    WHERE t.id::text = v_trade_id OR t.trade_id::text = v_trade_id
    LIMIT 1;

    v_canonical_trade_id := COALESCE(v_canonical_trade_id, v_trade_id);

    -- Serialize sends for this canonical trade and sender.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('paxones-trade-chat:' || v_canonical_trade_id || ':' || v_sender_id, 0)
    );

    -- The policy is 100 human messages per participant per trade, not 100 total.
    -- UNION deduplicates mirrored records using sender, message text, and timestamp,
    -- preventing the same logical message in both stores from consuming two slots.
    -- The advisory lock is shared across both trigger paths.
    IF to_regclass('public.trade_chat_messages') IS NOT NULL THEN
        EXECUTE $count_logical_messages$
            SELECT COUNT(*)
            FROM (
                SELECT m.sender_id::text AS sender_id, m.message::text AS message, m.created_at
                FROM public.trade_messages m
                WHERE m.trade_id::text = ANY (ARRAY[$1, $3, $4]) AND m.sender_id::text = $2
                UNION
                SELECT c.sender_id::text AS sender_id, c.message::text AS message, c.created_at
                FROM public.trade_chat_messages c
                WHERE c.trade_id::text = ANY (ARRAY[$1, $3, $4]) AND c.sender_id::text = $2
            ) AS logical_messages
        $count_logical_messages$
        INTO v_message_count
        USING v_canonical_trade_id, v_sender_id, v_public_trade_id, v_trade_id;
    ELSE
        SELECT COUNT(*)
        INTO v_message_count
        FROM public.trade_messages m
        WHERE m.trade_id::text = ANY (ARRAY[v_canonical_trade_id, v_public_trade_id, v_trade_id])
          AND m.sender_id::text = v_sender_id;
    END IF;

    IF v_message_count >= 100 THEN
        RAISE EXCEPTION 'You have reached your 100-message limit for this trade. Contact support@paxones.com with Trade ID % and explain what moderators should review.', v_trade_id
            USING ERRCODE = 'P0001',
                  DETAIL = 'TRADE_CHAT_LIMIT_REACHED';
    END IF;

    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_trade_chat_message_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS b_enforce_trade_chat_message_limit ON public.trade_messages;
CREATE TRIGGER b_enforce_trade_chat_message_limit
BEFORE INSERT ON public.trade_messages
FOR EACH ROW
EXECUTE FUNCTION public.enforce_trade_chat_message_limit();

DO $legacy_chat_trigger$
BEGIN
    IF to_regclass('public.trade_chat_messages') IS NOT NULL THEN
        EXECUTE 'DROP TRIGGER IF EXISTS enforce_trade_chat_message_limit ON public.trade_chat_messages';
        EXECUTE 'CREATE TRIGGER enforce_trade_chat_message_limit BEFORE INSERT ON public.trade_chat_messages FOR EACH ROW EXECUTE FUNCTION public.enforce_trade_chat_message_limit()';
    END IF;
END;
$legacy_chat_trigger$;


CREATE OR REPLACE FUNCTION public.purge_expired_trade_chat_and_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_trade_messages_deleted bigint := 0;
    v_legacy_messages_deleted bigint := 0;
    v_notifications_deleted bigint := 0;
BEGIN
    WITH expired_trades AS (
        SELECT t.id, t.trade_id
        FROM public.trades t
        WHERE LOWER(COALESCE(t.status::text, '')) IN ('completed', 'released', 'cancelled', 'canceled', 'expired')
          AND COALESCE(t.is_disputed, false) = false
          AND COALESCE(t.resolved_at, t.completed_at, t.released_at, t.cancelled_at, t.updated_at, t.created_at)
              < NOW() - INTERVAL '30 days'
    )
    DELETE FROM public.trade_messages m
    USING expired_trades t
    WHERE m.trade_id = t.id::text OR m.trade_id = t.trade_id;
    GET DIAGNOSTICS v_trade_messages_deleted = ROW_COUNT;

    IF to_regclass('public.trade_chat_messages') IS NOT NULL THEN
        EXECUTE $purge_legacy$
            WITH expired_trades AS (
                SELECT t.id
                FROM public.trades t
                WHERE LOWER(COALESCE(t.status::text, '')) IN ('completed', 'released', 'cancelled', 'canceled', 'expired')
                  AND COALESCE(t.is_disputed, false) = false
                  AND COALESCE(t.resolved_at, t.completed_at, t.released_at, t.cancelled_at, t.updated_at, t.created_at)
                      < NOW() - INTERVAL '30 days'
            )
            DELETE FROM public.trade_chat_messages m
            USING expired_trades t
            WHERE m.trade_id = t.id
        $purge_legacy$;
        GET DIAGNOSTICS v_legacy_messages_deleted = ROW_COUNT;
    END IF;

    DELETE FROM public.notifications
    WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;

    RETURN jsonb_build_object(
        'trade_messages_deleted', v_trade_messages_deleted,
        'legacy_trade_chat_messages_deleted', v_legacy_messages_deleted,
        'notifications_deleted', v_notifications_deleted
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_expired_trade_chat_and_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_trade_chat_and_notifications() TO service_role, postgres;

DO $schedule$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'paxones-chat-notification-retention'
    ) THEN
        PERFORM cron.schedule(
            'paxones-chat-notification-retention',
            '17 3 * * *',
            'SELECT public.purge_expired_trade_chat_and_notifications();'
        );
    END IF;
END;
$schedule$;

COMMIT;
