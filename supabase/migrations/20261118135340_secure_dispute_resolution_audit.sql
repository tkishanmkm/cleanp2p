-- Wayones: service-only dispute resolution boundary with atomic audit logging.
BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_trade_dispute_with_audit(
    p_dispute_id UUID,
    p_resolution TEXT,
    p_winner_id UUID,
    p_caller_id UUID,
    p_admin_email TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_trade_id UUID;
    v_buyer_id TEXT;
    v_seller_id TEXT;
    v_dispute_status TEXT;
    v_resolution TEXT;
    v_notes TEXT;
    v_is_active_admin BOOLEAN := FALSE;
    v_result JSONB;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND SESSION_USER NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_dispute_id IS NULL OR p_winner_id IS NULL OR p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Dispute, winner and administrator IDs are required.'
            USING ERRCODE = '22023';
    END IF;

    v_resolution := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_resolution, '')));
    IF v_resolution NOT IN ('RELEASE', 'CANCEL') THEN
        RAISE EXCEPTION 'Resolution must be RELEASE or CANCEL.'
            USING ERRCODE = '22023';
    END IF;

    v_notes := NULLIF(pg_catalog.btrim(COALESCE(p_notes, '')), '');
    IF v_notes IS NOT NULL AND pg_catalog.length(v_notes) > 2000 THEN
        RAISE EXCEPTION 'Resolution notes exceed the 2,000 character limit.'
            USING ERRCODE = '22023';
    END IF;

    -- Revalidate the supplied administrator against current database state.
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles AS p
        WHERE p.id = p_caller_id
          AND COALESCE(p.is_banned, FALSE) = FALSE
          AND COALESCE(p.is_restricted, FALSE) = FALSE
          AND COALESCE(p.is_on_hold, FALSE) = FALSE
          AND COALESCE(p.is_suspended, FALSE) = FALSE
          AND pg_catalog.lower(COALESCE(p.account_status, 'active')) NOT IN
              ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending')
          AND (p.role = 'admin' OR p.is_admin IS TRUE OR p.is_admin_account IS TRUE)
    ) OR EXISTS (
        SELECT 1
        FROM public.app_admins AS a
        JOIN public.profiles AS p ON p.id = a.user_id
        WHERE a.user_id = p_caller_id
          AND a.role IN ('admin', 'superadmin')
          AND COALESCE(p.is_banned, FALSE) = FALSE
          AND COALESCE(p.is_restricted, FALSE) = FALSE
          AND COALESCE(p.is_on_hold, FALSE) = FALSE
          AND COALESCE(p.is_suspended, FALSE) = FALSE
          AND pg_catalog.lower(COALESCE(p.account_status, 'active')) NOT IN
              ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending')
    )
    INTO v_is_active_admin;

    IF NOT v_is_active_admin THEN
        RAISE EXCEPTION 'Caller is not an active full administrator.'
            USING ERRCODE = '42501', DETAIL = 'ACTIVE_ADMIN_REQUIRED';
    END IF;

    SELECT d.trade_id::UUID, d.status::TEXT
    INTO v_trade_id, v_dispute_status
    FROM public.disputes AS d
    WHERE d.id = p_dispute_id
    FOR UPDATE;

    IF v_trade_id IS NULL THEN
        RAISE EXCEPTION 'Dispute not found.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT t.buyer_id::TEXT, t.seller_id::TEXT
    INTO v_buyer_id, v_seller_id
    FROM public.trades AS t
    WHERE t.id = v_trade_id
    FOR UPDATE;

    IF v_buyer_id IS NULL OR v_seller_id IS NULL THEN
        RAISE EXCEPTION 'Dispute trade or participants are missing.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_resolution = 'RELEASE' AND p_winner_id::TEXT IS DISTINCT FROM v_buyer_id THEN
        RAISE EXCEPTION 'RELEASE must award the trade to its buyer.'
            USING ERRCODE = '22023';
    END IF;

    IF v_resolution = 'CANCEL' AND p_winner_id::TEXT IS DISTINCT FROM v_seller_id THEN
        RAISE EXCEPTION 'CANCEL must award the trade to its seller.'
            USING ERRCODE = '22023';
    END IF;

    -- The canonical settlement and dispute-state transition run in this same transaction.
    v_result := public.resolve_trade_dispute(
        p_dispute_id,
        v_resolution,
        p_winner_id,
        p_caller_id
    );

    IF COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Canonical dispute settlement did not succeed.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Idempotent retries must not create duplicate audit records.
    IF pg_catalog.lower(COALESCE(v_dispute_status, '')) <> 'resolved' THEN
        UPDATE public.disputes
        SET resolution_reason = COALESCE(v_notes, resolution_reason),
            resolution_note = COALESCE(v_notes, resolution_note),
            updated_at = NOW()
        WHERE id = p_dispute_id;

        INSERT INTO public.admin_audit_logs (
            admin_id,
            admin_email,
            action,
            target_id,
            target_user_id,
            details
        ) VALUES (
            p_caller_id,
            NULLIF(pg_catalog.btrim(COALESCE(p_admin_email, '')), ''),
            'RESOLVE_DISPUTE',
            v_trade_id::TEXT,
            p_winner_id,
            pg_catalog.jsonb_build_object(
                'dispute_id', p_dispute_id,
                'trade_id', v_trade_id,
                'resolution', v_resolution,
                'winner_id', p_winner_id,
                'notes', v_notes,
                'settlement_result', v_result
            )
        );
    END IF;

    RETURN v_result || pg_catalog.jsonb_build_object('audit_logged', TRUE);
END;
$$;

ALTER FUNCTION public.resolve_trade_dispute_with_audit(UUID, TEXT, UUID, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.resolve_trade_dispute_with_audit(UUID, TEXT, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute_with_audit(UUID, TEXT, UUID, UUID, TEXT, TEXT) TO service_role, postgres;

-- The lower-level dispute resolver is no longer callable directly from browser sessions.
REVOKE ALL ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID) TO service_role, postgres;

COMMIT;
