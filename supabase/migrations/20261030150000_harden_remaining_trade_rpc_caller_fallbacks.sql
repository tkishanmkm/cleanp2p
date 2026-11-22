-- Harden the remaining trusted-caller fallback in release_trade_escrow.
-- resolve_trade_dispute is handled by the immediately preceding
-- 20261030130000_harden_resolve_trade_dispute_trusted_caller.sql migration.
-- Do not patch it twice: a second rewrite would fail its exact-shape guard.
-- Local candidate only: validate against isolated staging before deployment.
BEGIN;

DO $patch_remaining_trade_caller_fallbacks$
DECLARE
    v_target record;
    v_function_oid oid;
    v_definition text;
    v_pattern text;
    v_replacement text;
    v_patched_definition text;
BEGIN
    FOR v_target IN
        SELECT *
        FROM (VALUES
            ('public.release_trade_escrow(uuid,uuid)', 'p_caller_id')
        ) AS targets(signature, caller_parameter)
    LOOP
        v_function_oid := to_regprocedure(v_target.signature)::oid;

        IF v_function_oid IS NULL THEN
            RAISE EXCEPTION 'Required trade RPC is missing: %', v_target.signature;
        END IF;

        v_definition := pg_get_functiondef(v_function_oid);

        IF position('Trusted caller identity is only permitted for service-role execution.' IN v_definition) > 0 THEN
            CONTINUE;
        END IF;

        v_pattern := 'ELSE[[:space:]]+IF ' || v_target.caller_parameter || ' IS NULL THEN';

        IF regexp_count(v_definition, v_pattern) <> 1 THEN
            RAISE EXCEPTION
                'Expected exactly one trusted-caller fallback in %, found %',
                v_target.signature,
                regexp_count(v_definition, v_pattern);
        END IF;

        v_replacement := format($guard$ELSE
        IF COALESCE(auth.role(), '') <> 'service_role' THEN
            RAISE EXCEPTION 'Trusted caller identity is only permitted for service-role execution.'
                USING ERRCODE = '42501';
        END IF;
        IF %s IS NULL THEN$guard$, v_target.caller_parameter);

        v_patched_definition := regexp_replace(
            v_definition,
            v_pattern,
            v_replacement,
            'g'
        );

        IF v_patched_definition = v_definition
           OR position('Trusted caller identity is only permitted for service-role execution.' IN v_patched_definition) = 0 THEN
            RAISE EXCEPTION 'Trusted-caller hardening made no validated change to %', v_target.signature;
        END IF;

        EXECUTE v_patched_definition;
    END LOOP;
END;
$patch_remaining_trade_caller_fallbacks$;

COMMIT;
