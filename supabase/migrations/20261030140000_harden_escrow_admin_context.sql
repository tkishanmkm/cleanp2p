[Reading 66 lines from start (total: 66 lines, 0 remaining)]

-- Prevent service-role execution context from being treated as the requesting admin
-- in participant-facing escrow RPCs. Bind profile-based admin checks to a real
-- authenticated user and preserve server-managed app_admins/app_metadata checks.
-- Match the current deployed function shape; fail closed on unexpected drift.
-- The existing raw_app_meta_data admin predicate is preserved by a prefix-only rewrite.
-- Local candidate only: validate on schema-matched staging before deployment.
BEGIN;

DO $harden_escrow_admin_context$
DECLARE
    v_signature text;
    v_oid oid;
    v_definition text;
    v_patched text;
    v_pattern text := 'v_is_admin[[:space:]]*:=[[:space:]]*public\.is_admin\(\)[[:space:]]+OR';
    v_replacement text := 'v_is_admin := (v_auth_uid IS NOT NULL AND public.is_admin()) OR EXISTS (SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = v_effective_caller) OR';
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

        -- Idempotent success only when the exact authenticated-admin guard exists.
        IF position('v_auth_uid IS NOT NULL AND public.is_admin()' IN v_definition) > 0
           AND position('raw_user_meta_data' IN v_definition) = 0
           AND position('FROM public.app_admins AS aa WHERE aa.user_id = v_effective_caller' IN v_definition) > 0 THEN
            CONTINUE;
        END IF;

        -- These live functions must not regain user-editable metadata authorization.
        IF position('raw_user_meta_data' IN v_definition) > 0 THEN
            RAISE EXCEPTION
                'Unexpected user-editable metadata reference in %; use the separately reviewed metadata-removal migration.',
                v_signature;
        END IF;

        IF position('v_auth_uid UUID := auth.uid()' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'Expected authenticated actor variable is missing from %.', v_signature;
        END IF;

        IF regexp_count(v_definition, v_pattern) <> 1 THEN
            RAISE EXCEPTION
                'Expected exactly one current admin-context predicate in %, found %; refusing to patch.',
                v_signature, regexp_count(v_definition, v_pattern);
        END IF;

        v_patched := regexp_replace(v_definition, v_pattern, v_replacement, 'g');

        IF v_patched = v_definition
           OR position('v_auth_uid IS NOT NULL AND public.is_admin()' IN v_patched) = 0
           OR position('FROM public.app_admins AS aa WHERE aa.user_id = v_effective_caller' IN v_patched) = 0
           OR position('raw_user_meta_data' IN v_patched) > 0 THEN
            RAISE EXCEPTION 'Escrow admin-context hardening failed validation for %.', v_signature;
        END IF;

        EXECUTE v_patched;
    END LOOP;
END;
$harden_escrow_admin_context$;

COMMIT;
