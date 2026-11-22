-- Restrict caller-supplied identity fallback in escrow RPCs.
-- Matches the verified deployed IF/ELSE structure while failing closed on drift.
-- Prepared locally only; do not apply to production without isolated SQL tests.
BEGIN;

DO $patch_escrow_callers$
DECLARE
    v_signature text;
    v_oid oid;
    v_definition text;
    v_patched text;
    v_pattern text := $pattern$IF v_auth_uid IS NOT NULL THEN[[:space:]]+IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN[[:space:]]+RAISE EXCEPTION '[^']*';[[:space:]]+END IF;[[:space:]]+v_effective_caller := v_auth_uid;[[:space:]]+ELSE[[:space:]]+IF p_caller_id IS NULL THEN[[:space:]]+RAISE EXCEPTION '[^']*';[[:space:]]+END IF;[[:space:]]+v_effective_caller := p_caller_id;[[:space:]]+END IF;$pattern$;
    v_guard text := $guard$
IF v_auth_uid IS NOT NULL THEN
    IF p_caller_id IS NOT NULL AND p_caller_id IS DISTINCT FROM v_auth_uid THEN
        RAISE EXCEPTION 'Caller identity mismatch.' USING ERRCODE = '42501';
    END IF;
    v_effective_caller := v_auth_uid;
ELSE
    -- SECURITY DEFINER changes current_user to the function owner. Trust only
    -- the PostgREST JWT role claim for the service-role fallback.
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted caller identity is only permitted for service-role execution.'
            USING ERRCODE = '42501';
    END IF;
    IF p_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;
    v_effective_caller := p_caller_id;
END IF;
$guard$;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.release_trade_escrow(uuid,uuid)',
        'public.cancel_p2p_trade(uuid,uuid,text)'
    ] LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required escrow RPC % is missing; refusing partial hardening.', v_signature;
        END IF;

        v_definition := pg_get_functiondef(v_oid);

        -- The earlier trusted-caller migration already hardens cancel_p2p_trade.
        -- Accept that safe state rather than aborting the entire transaction.
        IF position('Trusted caller identity is only permitted for service-role execution.' IN v_definition) > 0 THEN
            IF regexp_count(v_definition, 'Trusted caller identity is only permitted for service-role execution.') <> 1 THEN
                RAISE EXCEPTION 'Unexpected duplicate trusted-caller guards in %.', v_signature;
            END IF;
            CONTINUE;
        END IF;

        IF regexp_count(v_definition, v_pattern) <> 1 THEN
            RAISE EXCEPTION 'Expected exactly one verified caller block in %, found %.',
                v_signature, regexp_count(v_definition, v_pattern);
        END IF;

        v_patched := regexp_replace(v_definition, v_pattern, v_guard, 'g');
        IF v_patched = v_definition OR position('Trusted caller identity is only permitted for service-role execution.' IN v_patched) = 0 THEN
            RAISE EXCEPTION 'Escrow caller hardening made no verified change to %.', v_signature;
        END IF;

        EXECUTE v_patched;
    END LOOP;
END;
$patch_escrow_callers$;

COMMIT;
