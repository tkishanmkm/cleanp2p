-- Harden resolve_trade_dispute against unauthenticated caller-ID spoofing.
-- Preserve the installed function body and ACLs; only allow the caller-ID
-- fallback when the PostgreSQL role is service_role.
-- Validate in an isolated staging database before any deployment.
BEGIN;

DO $patch_dispute_caller_fallback$
DECLARE
    v_signature text := 'public.resolve_trade_dispute(uuid,text,uuid,uuid)';
    v_function_oid oid;
    v_definition text;
    v_pattern text := 'ELSE[[:space:]]+IF p_caller_id IS NULL THEN';
    v_replacement text;
    v_patched_definition text;
BEGIN
    v_function_oid := to_regprocedure(v_signature)::oid;

    IF v_function_oid IS NULL THEN
        RAISE EXCEPTION 'Required dispute RPC is missing: %', v_signature;
    END IF;

    v_definition := pg_get_functiondef(v_function_oid);

    IF position('Trusted caller identity is only permitted for service-role execution.' IN v_definition) > 0 THEN
        -- Already hardened: safe idempotent no-op.
        RETURN;
    END IF;

    IF regexp_count(v_definition, v_pattern) <> 1 THEN
        RAISE EXCEPTION
            'Expected exactly one caller-ID fallback in %, found %; refusing to patch.',
            v_signature,
            regexp_count(v_definition, v_pattern);
    END IF;

    v_replacement := $guard$ELSE
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            RAISE EXCEPTION 'Trusted caller identity is only permitted for service-role execution.'
                USING ERRCODE = '42501';
        END IF;
        IF p_caller_id IS NULL THEN$guard$;

    v_patched_definition := regexp_replace(
        v_definition,
        v_pattern,
        v_replacement,
        'g'
    );

    IF v_patched_definition = v_definition THEN
        RAISE EXCEPTION 'Trusted-caller hardening made no change to %', v_signature;
    END IF;

    EXECUTE v_patched_definition;
END;
$patch_dispute_caller_fallback$;

COMMIT;
