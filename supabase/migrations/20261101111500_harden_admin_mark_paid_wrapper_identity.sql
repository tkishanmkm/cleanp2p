-- Forward hardening for the service-role-only administrator mark-paid wrapper.
-- The wrapper is created by 20261031111719; this migration adds the independent
-- durable active-admin check after the Auth identity lookup.
-- Candidate only: replay on a schema-faithful disposable PostgreSQL database.
BEGIN;

DO $harden_admin_mark_paid_identity$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_patched TEXT;
    v_pattern TEXT := '(IF NOT FOUND THEN[[:space:]]+RAISE EXCEPTION ''Authenticated administrator user not found\.''[[:space:]]+USING ERRCODE = ''P0002'';[[:space:]]+END IF;)';
BEGIN
    v_oid := to_regprocedure(
        'public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)'
    );

    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Admin mark-paid wrapper is missing; refusing partial hardening.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);

    IF position('public.check_is_admin(p_actor_id, NULL)' IN lower(v_definition)) > 0 THEN
        ALTER FUNCTION public.admin_mark_trade_paid_authorized(UUID, UUID, TEXT, TEXT)
            SET search_path = '';
        RETURN;
    END IF;

    IF position('FROM auth.users AS u' IN v_definition) = 0
       OR position('WHERE u.id = p_actor_id' IN v_definition) = 0
       OR position('public.mark_p2p_trade_paid(' IN v_definition) = 0
       OR position('ADMIN_MARKED_TRADE_PAID' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Admin mark-paid wrapper does not match the reviewed server-only shape.';
    END IF;

    IF regexp_count(v_definition, v_pattern, 1, 'i') <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one verified Auth actor lookup guard in admin mark-paid wrapper.';
    END IF;

    v_patched := regexp_replace(
        v_definition,
        v_pattern,
        E'\\1\n\n    -- A service-role JWT authenticates the server, not the claimed human actor.\n    -- Revalidate the actor against durable, active administrator records.\n    IF NOT public.check_is_admin(p_actor_id, NULL) THEN\n        RAISE EXCEPTION ''A full, active administrator account is required.''\n            USING ERRCODE = ''42501'';\n    END IF;',
        'i'
    );

    IF v_patched = v_definition
       OR position('public.check_is_admin(p_actor_id, NULL)' IN lower(v_patched)) = 0 THEN
        RAISE EXCEPTION 'Could not add a verified active-admin check to the mark-paid wrapper.';
    END IF;

    EXECUTE v_patched;
    ALTER FUNCTION public.admin_mark_trade_paid_authorized(UUID, UUID, TEXT, TEXT)
        SET search_path = '';
END;
$harden_admin_mark_paid_identity$;

COMMIT;
