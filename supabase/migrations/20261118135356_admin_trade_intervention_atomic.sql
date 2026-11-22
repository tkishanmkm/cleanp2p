-- Wayones: atomic, server-only admin escrow intervention for disputed and non-disputed trades.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_intervene_trade_escrow(
    p_trade_id UUID,
    p_action TEXT,
    p_caller_id UUID,
    p_admin_email TEXT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_trade RECORD;
    v_admin_profile JSONB;
    v_admin_status TEXT;
    v_profile_active BOOLEAN := FALSE;
    v_is_active_admin BOOLEAN := FALSE;
    v_action TEXT;
    v_resolution TEXT;
    v_winner_id UUID;
    v_dispute_ids UUID[];
    v_dispute_id UUID;
    v_reason TEXT;
    v_result JSONB;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND SESSION_USER NOT IN ('postgres', 'supabase_admin') THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_trade_id IS NULL OR p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Trade and administrator IDs are required.'
            USING ERRCODE = '22023';
    END IF;

    v_action := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_action, '')));
    IF v_action NOT IN ('release', 'refund', 'mark_paid') THEN
        RAISE EXCEPTION 'Action must be release, refund or mark_paid.'
            USING ERRCODE = '22023';
    END IF;

    v_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');
    IF v_reason IS NOT NULL AND pg_catalog.length(v_reason) > 2000 THEN
        RAISE EXCEPTION 'Intervention reason exceeds the 2,000 character limit.'
            USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.to_jsonb(p)
    INTO v_admin_profile
    FROM public.profiles AS p
    WHERE p.id = p_caller_id
    FOR UPDATE;

    IF v_admin_profile IS NOT NULL THEN
        v_admin_status := pg_catalog.lower(COALESCE(
            NULLIF(v_admin_profile ->> 'account_status', ''),
            NULLIF(v_admin_profile ->> 'status', ''),
            'active'
        ));

        v_profile_active :=
            COALESCE((v_admin_profile ->> 'is_banned')::BOOLEAN, FALSE) = FALSE
            AND COALESCE((v_admin_profile ->> 'is_restricted')::BOOLEAN, FALSE) = FALSE
            AND COALESCE((v_admin_profile ->> 'is_suspended')::BOOLEAN, FALSE) = FALSE
            AND COALESCE((v_admin_profile ->> 'is_on_hold')::BOOLEAN, FALSE) = FALSE
            AND v_admin_status NOT IN ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending');

        v_is_active_admin := v_profile_active AND (
            v_admin_profile ->> 'role' = 'admin'
            OR COALESCE((v_admin_profile ->> 'is_admin')::BOOLEAN, FALSE)
            OR COALESCE((v_admin_profile ->> 'is_admin_account')::BOOLEAN, FALSE)
        );

        IF v_profile_active AND NOT v_is_active_admin THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.app_admins AS a
                WHERE a.user_id = p_caller_id
                  AND a.role IN ('admin', 'superadmin')
            ) INTO v_is_active_admin;
        END IF;
    END IF;

    IF NOT v_is_active_admin THEN
        RAISE EXCEPTION 'Caller is not an active full administrator.'
            USING ERRCODE = '42501', DETAIL = 'ACTIVE_ADMIN_REQUIRED';
    END IF;

    SELECT *
    INTO v_trade
    FROM public.trades AS t
    WHERE t.id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_action = 'release' THEN
        v_resolution := 'RELEASE';
        v_winner_id := NULLIF(v_trade.buyer_id::TEXT, '')::UUID;
    ELSIF v_action = 'refund' THEN
        v_resolution := 'CANCEL';
        v_winner_id := NULLIF(v_trade.seller_id::TEXT, '')::UUID;
    ELSE
        v_resolution := NULL;
        v_winner_id := NULL;
    END IF;

    IF v_action <> 'mark_paid' AND v_winner_id IS NULL THEN
        RAISE EXCEPTION 'Trade winner identity is invalid.'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_action = 'mark_paid'
       AND (v_trade.paid_at IS NOT NULL OR v_trade.marked_paid_at IS NOT NULL)
       AND (pg_catalog.lower(COALESCE(v_trade.status::TEXT, '')) IN ('paid', 'buyer_marked_paid', 'payment_sent')
            OR pg_catalog.lower(COALESCE(v_trade.escrow_status::TEXT, '')) = 'paid') THEN
        RETURN pg_catalog.jsonb_build_object(
            'success', TRUE,
            'trade_id', p_trade_id,
            'status', 'paid',
            'message', 'Trade is already marked as paid (idempotent replay).',
            'idempotent', TRUE,
            'audit_logged', FALSE
        );
    END IF;

    IF pg_catalog.lower(COALESCE(v_trade.status::TEXT, '')) IN ('completed', 'released', 'cancelled', 'expired')
       OR pg_catalog.lower(COALESCE(v_trade.escrow_status::TEXT, '')) IN ('completed', 'released', 'cancelled', 'expired') THEN
        RAISE EXCEPTION 'Terminal trades cannot be intervened again.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_ALREADY_TERMINAL';
    END IF;

    SELECT pg_catalog.array_agg(candidate.id)
    INTO v_dispute_ids
    FROM (
        SELECT d.id
        FROM public.disputes AS d
        WHERE d.trade_id = p_trade_id
          AND pg_catalog.lower(d.status::TEXT) IN ('open', 'pending', 'in_review', 'investigating')
        ORDER BY d.created_at DESC
        LIMIT 2
        FOR UPDATE
    ) AS candidate;

    IF COALESCE(pg_catalog.cardinality(v_dispute_ids), 0) > 1 THEN
        RAISE EXCEPTION 'Multiple active disputes exist for this trade; manual review is required.'
            USING ERRCODE = 'P0001', DETAIL = 'MULTIPLE_ACTIVE_DISPUTES';
    END IF;

    IF COALESCE(pg_catalog.cardinality(v_dispute_ids), 0) = 1 THEN
        IF v_action = 'mark_paid' THEN
            RAISE EXCEPTION 'A disputed trade cannot be marked paid by an administrator.'
                USING ERRCODE = 'P0001', DETAIL = 'TRADE_DISPUTE_ACTIVE';
        END IF;
        v_dispute_id := v_dispute_ids[1];
        RETURN public.resolve_trade_dispute_with_audit(
            v_dispute_id,
            v_resolution,
            v_winner_id,
            p_caller_id,
            p_admin_email,
            v_reason
        );
    END IF;

    IF COALESCE(v_trade.is_disputed, FALSE)
       OR pg_catalog.lower(COALESCE(v_trade.status::TEXT, '')) = 'disputed'
       OR pg_catalog.lower(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed' THEN
        RAISE EXCEPTION 'Trade is marked disputed but has no active dispute record.'
            USING ERRCODE = 'P0001', DETAIL = 'DISPUTED_TRADE_RECORD_MISSING';
    END IF;

    IF v_action = 'release' THEN
        v_result := public.release_trade_escrow(p_trade_id, p_caller_id);
    ELSIF v_action = 'refund' THEN
        v_result := public.cancel_p2p_trade(p_trade_id, p_caller_id, COALESCE(v_reason, 'Administrator escrow refund'));
    ELSE
        v_result := public.mark_p2p_trade_paid(p_trade_id, p_caller_id, v_trade.payment_method::TEXT);
    END IF;

    IF COALESCE((v_result ->> 'success')::BOOLEAN, FALSE) IS NOT TRUE THEN
        RAISE EXCEPTION 'Canonical escrow intervention did not succeed.'
            USING ERRCODE = 'P0001';
    END IF;

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
        CASE WHEN v_action = 'release' THEN 'ADMIN_ESCROW_RELEASE' WHEN v_action = 'refund' THEN 'ADMIN_ESCROW_REFUND' ELSE 'ADMIN_MARK_TRADE_PAID' END,
        p_trade_id::TEXT,
        CASE WHEN v_action = 'mark_paid' THEN NULLIF(v_trade.buyer_id::TEXT, '')::UUID ELSE v_winner_id END,
        pg_catalog.jsonb_build_object(
            'trade_id', p_trade_id,
            'action', v_action,
            'winner_id', v_winner_id,
            'reason', v_reason,
            'settlement_result', v_result
        )
    );

    RETURN v_result || pg_catalog.jsonb_build_object('audit_logged', TRUE, 'dispute_resolved', FALSE);
END;
$$;

ALTER FUNCTION public.admin_intervene_trade_escrow(UUID, TEXT, UUID, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_intervene_trade_escrow(UUID, TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_intervene_trade_escrow(UUID, TEXT, UUID, TEXT, TEXT) TO service_role, postgres;

COMMIT;
