-- Restrict administrator exceptions in participant trade RPCs to a trusted server context.
-- Participant JWTs must be buyer/seller only. Admin actions use verifyServerAdmin(),
-- including the signed Admin 2FA cookie, and then call the server-only wrapper below.
BEGIN;

DO $migration$
DECLARE
    v_signature TEXT;
    v_oid OID;
    v_definition TEXT;
    v_patched_definition TEXT;
    v_pattern TEXT := 'v_is_admin[[:space:]]*:=[[:space:]]*[^;]+;';
    v_signatures TEXT[] := ARRAY[
        'public.cancel_p2p_trade(uuid,uuid,text)',
        'public.mark_p2p_trade_paid(uuid,uuid,text)',
        'public.raise_trade_dispute(uuid,uuid,text)'
    ];
BEGIN
    FOREACH v_signature IN ARRAY v_signatures LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required participant trade RPC not found: %', v_signature;
        END IF;

        v_definition := pg_get_functiondef(v_oid);
        IF regexp_count(v_definition, v_pattern, 1, 'i') <> 1 THEN
            RAISE EXCEPTION
                'Expected one administrator predicate in %, found %; refusing to patch.',
                v_signature,
                regexp_count(v_definition, v_pattern, 1, 'i');
        END IF;

        IF position('COALESCE(auth.jwt() ->> ''role'', '''') = ''service_role''' IN v_definition) > 0 THEN
            CONTINUE;
        END IF;

        v_patched_definition := regexp_replace(
            v_definition,
            v_pattern,
            'v_is_admin := COALESCE(auth.jwt() ->> ''role'', '''') = ''service_role'';',
            'i'
        );

        IF v_patched_definition = v_definition THEN
            RAISE EXCEPTION 'Administrator predicate hardening made no change to %.', v_signature;
        END IF;

        IF position('raw_user_meta_data' IN v_patched_definition) > 0
           AND v_signature IN (
             'public.mark_p2p_trade_paid(uuid,uuid,text)',
             'public.raise_trade_dispute(uuid,uuid,text)'
           ) THEN
            -- These two functions have no other user-metadata use; an unexpected
            -- surviving reference means the live definition must be reviewed.
            RAISE EXCEPTION 'Unexpected user-editable metadata reference remains in %.', v_signature;
        END IF;

        EXECUTE v_patched_definition;
    END LOOP;
END
$migration$;

-- Atomic full-admin mark-paid path. The caller must be service_role, and the
-- Next.js route must first verify the real administrator and signed 2FA session.
CREATE OR REPLACE FUNCTION public.admin_mark_trade_paid_authorized(
    p_trade_id UUID,
    p_actor_id UUID,
    p_actor_email TEXT,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_clean_reason TEXT := NULLIF(BTRIM(p_reason), '');
    v_payment_method TEXT;
    v_target_user_id UUID;
    v_result JSONB;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_trade_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'Trade and verified administrator actor are required.'
            USING ERRCODE = '22023';
    END IF;

    IF v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 10 THEN
        RAISE EXCEPTION 'An administrative reason of at least 10 characters is required.'
            USING ERRCODE = '22023';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Authenticated administrator user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    v_actor_email := COALESCE(v_actor_email, v_supplied_email);

    SELECT t.buyer_id::UUID, t.payment_method
      INTO v_target_user_id, v_payment_method
      FROM public.trades AS t
     WHERE t.id = p_trade_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Reuse the canonical atomic transition. In this trusted server context
    -- it permits the admin override; participant JWT callers cannot do so.
    v_result := public.mark_p2p_trade_paid(
        p_trade_id,
        p_actor_id,
        v_payment_method
    );

    IF COALESCE(v_result ->> 'success', 'false') <> 'true' THEN
        RAISE EXCEPTION 'Canonical trade paid transition was not confirmed.'
            USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        p_actor_id,
        v_actor_email,
        'ADMIN_MARKED_TRADE_PAID',
        p_trade_id::TEXT,
        v_target_user_id,
        JSONB_BUILD_OBJECT(
            'trade_id', p_trade_id,
            'reason', v_clean_reason,
            'payment_method', v_payment_method,
            'updated_at', NOW()
        ),
        NOW()
    );

    RETURN v_result || JSONB_BUILD_OBJECT('audit_logged', TRUE);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_trade_paid_authorized(UUID, UUID, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_mark_trade_paid_authorized(UUID, UUID, TEXT, TEXT)
    TO service_role, postgres;

COMMIT;
