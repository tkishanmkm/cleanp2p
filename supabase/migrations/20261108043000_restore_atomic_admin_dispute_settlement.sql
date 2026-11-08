-- Forward installation of atomic full-administrator dispute settlement.
-- Uses the live actor-bound resolver already installed by the 20261103193657/
-- 20261103194003 hardening migrations. The runtime feature flag remains off
-- until isolated buyer/seller/replay/concurrency verification is completed.
BEGIN;

DO $precheck$
DECLARE
    v_definition text;
BEGIN
    IF to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)') IS NULL
       OR to_regprocedure('public.is_active_full_admin_actor(uuid)') IS NULL THEN
        RAISE EXCEPTION 'Canonical dispute resolver or active-admin predicate is missing.';
    END IF;

    SELECT pg_get_functiondef(
        'public.resolve_trade_dispute(uuid,text,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF position('public.is_active_admin_identity(v_effective_caller)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Canonical dispute resolver is not bound to the active administrator identity.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = 'public.is_active_admin_identity(uuid)'::regprocedure
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
    ) THEN
        RAISE EXCEPTION 'Active-admin predicate must remain SECURITY DEFINER with an empty search_path.';
    END IF;
END;
$precheck$;

ALTER FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID)
    SET search_path = '';
CREATE OR REPLACE FUNCTION public.admin_resolve_trade_dispute_atomic(
    p_dispute_id UUID,
    p_trade_id UUID,
    p_winner_id UUID,
    p_actor_id UUID,
    p_actor_email TEXT,
    p_resolution TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_resolution TEXT := NULLIF(BTRIM(p_resolution), '');
    v_dispute_trade_id UUID;
    v_trade public.trades%ROWTYPE;
    v_dispute public.disputes%ROWTYPE;
    v_final_dispute public.disputes%ROWTYPE;
    v_final_trade_status TEXT;
    v_final_escrow_status TEXT;
    v_winner_role TEXT;
    v_expected_trade_status TEXT;
    v_open_dispute_count INTEGER;
    v_audit_exists BOOLEAN := FALSE;
    v_result JSONB;
    v_message_written BOOLEAN := FALSE;
    v_notifications_written BOOLEAN := FALSE;
BEGIN
    -- Only a trusted server caller may invoke this wrapper. Admin identity and
    -- the signed 2FA session are verified by the Next.js server before the call.
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_dispute_id IS NULL OR p_trade_id IS NULL OR p_winner_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'Dispute, trade, winner, and verified administrator are required.'
            USING ERRCODE = '22023';
    END IF;

    IF v_resolution IS NULL OR LENGTH(v_resolution) < 10 OR LENGTH(v_resolution) > 2000 THEN
        RAISE EXCEPTION 'Resolution reason must contain between 10 and 2000 characters.'
            USING ERRCODE = '22023';
    END IF;

    -- Require a durable database administrator grant. Environment-only admin
    -- allowlisting is not enough to authorize irreversible escrow settlement.
    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Verified administrator account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    -- Keep the audit email sourced exclusively from auth.users; the supplied
    -- value is an assertion only and is never trusted as an audit identity.

    -- Reuse the deployed active-identity check so banned, suspended, on-hold,
    -- and disabled administrator accounts cannot perform irreversible actions.
    -- The predicate reads trusted Auth app_metadata and durable admin registries;
    -- it never reads user-editable raw_user_meta_data.
    IF NOT public.is_active_full_admin_actor(p_actor_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required for dispute settlement.'
            USING ERRCODE = '42501';
    END IF;

    -- Acquire locks in the same dispute -> trade order used by the canonical
    -- inner resolver. This prevents a lock-order inversion when any trusted
    -- service still invokes that resolver during a staged rollout.
    SELECT d.*
      INTO v_dispute
      FROM public.disputes AS d
     WHERE d.id = p_dispute_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dispute not found.'
            USING ERRCODE = 'P0002';
    END IF;

    v_dispute_trade_id := v_dispute.trade_id;
    IF v_dispute_trade_id <> p_trade_id THEN
        RAISE EXCEPTION 'Dispute does not belong to the requested trade.'
            USING ERRCODE = '42501';
    END IF;

    SELECT t.*
      INTO v_trade
      FROM public.trades AS t
     WHERE t.id = p_trade_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF p_winner_id::TEXT = v_trade.buyer_id::TEXT THEN
        v_winner_role := 'BUYER';
        v_expected_trade_status := 'completed';
    ELSIF p_winner_id::TEXT = v_trade.seller_id::TEXT THEN
        v_winner_role := 'SELLER';
        v_expected_trade_status := 'cancelled';
    ELSE
        RAISE EXCEPTION 'Dispute winner must be exactly the buyer or seller.'
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent replay is accepted only when this wrapper's audit evidence
    -- exists and records the same actor, trade, dispute, and winner.
    IF LOWER(COALESCE(v_dispute.status::TEXT, '')) = 'resolved' THEN
        SELECT EXISTS (
            SELECT 1
              FROM public.admin_audit_logs AS al
             WHERE al.action = 'ADMIN_RESOLVED_TRADE_DISPUTE'
               AND al.target_id = p_dispute_id::TEXT
               AND al.target_user_id = p_winner_id
               AND al.details ->> 'trade_id' = p_trade_id::TEXT
               AND al.details ->> 'actor_id' = p_actor_id::TEXT
        )
        INTO v_audit_exists;

        IF v_audit_exists AND v_dispute.winner_id = p_winner_id
           AND v_dispute.resolved_by = p_actor_id THEN
            v_final_trade_status := LOWER(COALESCE(v_trade.status::TEXT, ''));
            v_final_escrow_status := LOWER(COALESCE(v_trade.escrow_status::TEXT, ''));
            IF (v_winner_role = 'BUYER'
                AND (v_final_trade_status = 'completed' OR v_final_escrow_status = 'released'))
               OR (v_winner_role = 'SELLER'
                AND (v_final_trade_status = 'cancelled' OR v_final_escrow_status = 'cancelled')) THEN
                RETURN JSONB_BUILD_OBJECT(
                    'success', TRUE,
                    'settlement_succeeded', TRUE,
                    'audit_logged', TRUE,
                    'idempotent', TRUE,
                    'dispute_id', p_dispute_id,
                    'trade_id', p_trade_id,
                    'winner_id', p_winner_id,
                    'winner_role', v_winner_role
                );
            END IF;
        END IF;

        RAISE EXCEPTION 'Dispute is already resolved or requires manual financial reconciliation.'
            USING ERRCODE = 'P0001';
    END IF;

    IF LOWER(COALESCE(v_dispute.status::TEXT, '')) <> 'open' THEN
        RAISE EXCEPTION 'Only an open dispute can be resolved.'
            USING ERRCODE = 'P0001';
    END IF;

    IF NOT (
        LOWER(COALESCE(v_trade.status::TEXT, '')) IN ('disputed', 'dispute')
        OR LOWER(COALESCE(v_trade.escrow_status::TEXT, '')) = 'disputed'
        OR COALESCE(v_trade.is_disputed, FALSE) = TRUE
    ) THEN
        RAISE EXCEPTION 'The trade is not in a disputed state.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)
      INTO v_open_dispute_count
      FROM public.disputes AS d
     WHERE d.trade_id = p_trade_id
       AND LOWER(d.status::TEXT) = 'open';

    IF v_open_dispute_count <> 1 THEN
        RAISE EXCEPTION 'Trade must have exactly one open dispute before settlement.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Existing canonical RPC owns wallet and ledger mutations. It runs as this
    -- SECURITY DEFINER function owner (postgres), with the service-role JWT
    -- preserved for its trusted-caller checks.
    v_result := public.resolve_trade_dispute(
        p_dispute_id,
        v_resolution,
        p_winner_id,
        p_actor_id
    );

    IF COALESCE(v_result ->> 'success', 'false') <> 'true' THEN
        RAISE EXCEPTION 'Canonical dispute settlement did not confirm success.'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT d.*
      INTO v_final_dispute
      FROM public.disputes AS d
     WHERE d.id = p_dispute_id;

    SELECT LOWER(COALESCE(t.status::TEXT, '')),
           LOWER(COALESCE(t.escrow_status::TEXT, ''))
      INTO v_final_trade_status, v_final_escrow_status
      FROM public.trades AS t
     WHERE t.id = p_trade_id;

    IF LOWER(COALESCE(v_final_dispute.status::TEXT, '')) <> 'resolved'
       OR v_final_dispute.winner_id IS DISTINCT FROM p_winner_id
       OR v_final_dispute.resolved_by IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'Dispute state did not persist the requested winner and administrator.'
            USING ERRCODE = 'P0001';
    END IF;

    IF (v_winner_role = 'BUYER'
        AND NOT (v_final_trade_status = 'completed' OR v_final_escrow_status = 'released'))
       OR (v_winner_role = 'SELLER'
        AND NOT (v_final_trade_status = 'cancelled' OR v_final_escrow_status = 'cancelled')) THEN
        RAISE EXCEPTION 'Escrow settlement did not reach the expected terminal trade state.'
            USING ERRCODE = 'P0001';
    END IF;

    -- This mandatory audit insert is in the same transaction as settlement.
    -- If it fails, PostgreSQL rolls back the escrow/ledger and dispute changes.
    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
        p_actor_id,
        v_actor_email,
        'ADMIN_RESOLVED_TRADE_DISPUTE',
        p_dispute_id::TEXT,
        p_winner_id,
        JSONB_BUILD_OBJECT(
            'actor_id', p_actor_id,
            'dispute_id', p_dispute_id,
            'trade_id', p_trade_id,
            'winner_id', p_winner_id,
            'winner_role', v_winner_role,
            'resolution', v_resolution,
            'settlement_result', v_result
        ),
        NOW()
    );

    -- Chat and notifications are ancillary. They must not undo a verified
    -- escrow settlement if their optional insert path is temporarily unavailable.
    BEGIN
        INSERT INTO public.trade_messages (
            trade_id, sender_id, sender_username, message, is_moderator, created_at
        ) VALUES (
            p_trade_id::TEXT,
            '00000000-0000-0000-0000-000000000000',
            'Paxones System',
            'Dispute resolved. Escrow awarded to the ' || LOWER(v_winner_role) || '.',
            TRUE,
            NOW()
        );
        v_message_written := TRUE;
    EXCEPTION WHEN OTHERS THEN
        v_message_written := FALSE;
    END;

    BEGIN
        INSERT INTO public.notifications (
            user_id, title, message, type, is_read, metadata, created_at
        ) VALUES
        (
            CASE WHEN v_winner_role = 'BUYER' THEN v_trade.buyer_id::UUID ELSE v_trade.seller_id::UUID END,
            'Dispute Won',
            'Your dispute was resolved in your favor.',
            'dispute',
            FALSE,
            JSONB_BUILD_OBJECT('link', '/trade/' || p_trade_id::TEXT),
            NOW()
        ),
        (
            CASE WHEN v_winner_role = 'BUYER' THEN v_trade.seller_id::UUID ELSE v_trade.buyer_id::UUID END,
            'Dispute Resolved',
            'The dispute has been resolved by a Paxones administrator.',
            'dispute',
            FALSE,
            JSONB_BUILD_OBJECT('link', '/trade/' || p_trade_id::TEXT),
            NOW()
        );
        v_notifications_written := TRUE;
    EXCEPTION WHEN OTHERS THEN
        v_notifications_written := FALSE;
    END;

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'settlement_succeeded', TRUE,
        'audit_logged', TRUE,
        'idempotent', FALSE,
        'message_written', v_message_written,
        'notifications_written', v_notifications_written,
        'dispute_id', p_dispute_id,
        'trade_id', p_trade_id,
        'winner_id', p_winner_id,
        'winner_role', v_winner_role,
        'trade_status', v_final_trade_status,
        'escrow_status', v_final_escrow_status
    );
END;
$function$;

ALTER FUNCTION public.admin_resolve_trade_dispute_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT)
    OWNER TO postgres;

-- The legacy resolver has no audit wrapper and must not be directly callable by
-- API, worker, or client roles after the atomic wrapper is installed.
REVOKE ALL ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID)
    TO postgres;
ALTER FUNCTION public.resolve_trade_dispute(UUID, TEXT, UUID, UUID)
    SET search_path = '';

REVOKE ALL ON FUNCTION public.admin_resolve_trade_dispute_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_trade_dispute_atomic(UUID, UUID, UUID, UUID, TEXT, TEXT)
    TO service_role, postgres;

DO $verify$
DECLARE
    v_wrapper regprocedure :=
      to_regprocedure('public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)');
    v_resolver regprocedure :=
      to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
BEGIN
    IF v_wrapper IS NULL OR v_resolver IS NULL THEN
        RAISE EXCEPTION 'Atomic dispute wrapper or canonical resolver is missing after installation.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc
        WHERE oid = v_wrapper
          AND prosecdef IS TRUE
          AND proconfig @> ARRAY['search_path=""']::text[]
          AND pg_get_userbyid(proowner) = 'postgres'
    ) THEN
        RAISE EXCEPTION 'Atomic dispute wrapper must be SECURITY DEFINER, owned by postgres, with an empty search_path.';
    END IF;

    IF has_function_privilege('anon', v_wrapper, 'EXECUTE')
       OR has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_wrapper, 'EXECUTE') THEN
        RAISE EXCEPTION 'Atomic dispute wrapper grants do not match the server-only contract.';
    END IF;

    IF has_function_privilege('anon', v_resolver, 'EXECUTE')
       OR has_function_privilege('authenticated', v_resolver, 'EXECUTE')
       OR has_function_privilege('service_role', v_resolver, 'EXECUTE')
       OR NOT has_function_privilege('postgres', v_resolver, 'EXECUTE') THEN
        RAISE EXCEPTION 'Inner dispute resolver must be callable only by its postgres owner.';
    END IF;

    IF NOT has_function_privilege('service_role', 'public.release_trade_escrow(uuid,uuid)', 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.cancel_p2p_trade(uuid,uuid,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical financial settlement RPC grants changed unexpectedly.';
    END IF;
END;
$verify$;

COMMIT;
