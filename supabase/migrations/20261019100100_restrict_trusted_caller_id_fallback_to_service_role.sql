-- Prevent SECURITY DEFINER trade RPCs from trusting a caller-supplied user ID
-- when there is no authenticated Supabase user context.
-- This is a compatibility-safe patch: preserve each deployed function body and
-- change only the unauthenticated trusted-caller fallback. Never applies live
-- unless this migration is explicitly run against that database.

BEGIN;

DO $patch_trusted_caller_fallback$
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
            (
                'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)',
                'p_caller_id'
            ),
            (
                'public.mark_p2p_trade_paid(uuid,uuid,text)',
                'p_caller_id'
            ),
            (
                'public.cancel_p2p_trade(uuid,uuid,text)',
                'p_caller_id'
            ),
            (
                'public.raise_trade_dispute(uuid,uuid,text)',
                'p_user_id'
            )
        ) AS targets(signature, caller_parameter)
    LOOP
        v_function_oid := to_regprocedure(v_target.signature)::oid;

        IF v_function_oid IS NULL THEN
            RAISE EXCEPTION 'Required trade RPC is missing: %', v_target.signature;
        END IF;

        v_definition := pg_get_functiondef(v_function_oid);
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

        IF v_patched_definition = v_definition THEN
            RAISE EXCEPTION 'Trusted-caller hardening made no change to %', v_target.signature;
        END IF;

        EXECUTE v_patched_definition;
    END LOOP;
END;
$patch_trusted_caller_fallback$;

COMMIT;
