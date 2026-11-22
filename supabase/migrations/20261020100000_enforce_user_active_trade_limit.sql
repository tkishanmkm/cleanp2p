-- Enforce a per-user cap of 20 simultaneous non-terminal trades at the canonical
-- trades table boundary. This is intentionally an ACTIVE-trade cap, not a lifetime
-- cap: completed/cancelled/expired history remains available to users.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_user_active_trade_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_active_count INTEGER;
    v_terminal_statuses CONSTANT TEXT[] := ARRAY[
        'completed', 'released', 'cancelled', 'canceled', 'expired', 'resolved', 'refunded'
    ];
BEGIN
    -- Canonical RPC creates trades for both legacy and current API entry points.
    -- Validate participant IDs before using them for row locks or counts.
    IF NEW.buyer_id IS NULL OR NEW.seller_id IS NULL
       OR NEW.buyer_id::TEXT !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR NEW.seller_id::TEXT !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'Trade participants must be valid account UUIDs.'
            USING ERRCODE = 'P0001', DETAIL = 'INVALID_TRADE_PARTICIPANT';
    END IF;

    IF NEW.buyer_id::TEXT = NEW.seller_id::TEXT THEN
        RAISE EXCEPTION 'A user cannot be both participants in the same trade.'
            USING ERRCODE = 'P0001', DETAIL = 'SELF_TRADE_PROHIBITED';
    END IF;

    -- Serialize concurrent trade creations for each participant. Sorting both
    -- IDs gives all competing transactions the same lock order and avoids deadlocks.
    FOR v_user_id IN
        SELECT DISTINCT participant_id
        FROM unnest(ARRAY[NEW.buyer_id::UUID, NEW.seller_id::UUID]) AS p(participant_id)
        ORDER BY participant_id
    LOOP
        PERFORM 1
        FROM public.profiles
        WHERE id = v_user_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Trade participant profile is unavailable.'
                USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_PROFILE_UNAVAILABLE';
        END IF;

        -- A trade is considered active unless BOTH state fields indicate a
        -- terminal state. This fails closed if status fields disagree.
        SELECT COUNT(*)::INTEGER
        INTO v_active_count
        FROM public.trades AS t
        WHERE (t.buyer_id::TEXT = v_user_id::TEXT OR t.seller_id::TEXT = v_user_id::TEXT)
          AND NOT (
              LOWER(COALESCE(t.status::TEXT, '')) = ANY(v_terminal_statuses)
              AND LOWER(COALESCE(t.escrow_status::TEXT, '')) = ANY(v_terminal_statuses)
          );

        IF v_active_count >= 20 THEN
            RAISE EXCEPTION 'You can have at most 20 active trades at a time.'
                USING ERRCODE = 'P0001', DETAIL = 'ACTIVE_TRADE_LIMIT_REACHED';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_user_active_trade_limit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_user_active_trade_limit() FROM anon, authenticated;

DROP TRIGGER IF EXISTS enforce_user_active_trade_limit_before_insert ON public.trades;
CREATE TRIGGER enforce_user_active_trade_limit_before_insert
BEFORE INSERT ON public.trades
FOR EACH ROW
EXECUTE FUNCTION public.enforce_user_active_trade_limit();

COMMIT;
