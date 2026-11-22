-- Harden audit attribution in existing bulk user-management RPC definitions.
-- Fail closed if a deployed function has an unexpected body or is already patched.
DO $migration$
DECLARE
    v_signature TEXT;
    v_definition TEXT;
    v_prefix TEXT;
    v_body TEXT;
    v_suffix TEXT;
    v_body_start INTEGER;
    v_close_pos INTEGER;
    v_delimiter TEXT;
    v_patched TEXT;
    v_guard TEXT := $guard$
    IF auth.role() = 'service_role' THEN
        -- The service-role key is a transport privilege, not the audit actor.
        -- Require the actor ID supplied by the server-verified route and prefer
        -- the canonical profile email over any caller-supplied display value.
        v_effective_admin_id := p_admin_id;
        IF v_effective_admin_id IS NULL THEN
            RAISE EXCEPTION 'Bulk admin operation requires an explicit auditable actor ID.';
        END IF;
        SELECT NULLIF(btrim(p.email), '') INTO v_effective_admin_email
        FROM public.profiles p
        WHERE p.id = v_effective_admin_id;
        IF p_admin_email IS NOT NULL AND NULLIF(btrim(p_admin_email), '') IS NOT NULL THEN
            IF v_effective_admin_email IS NOT NULL
               AND lower(btrim(p_admin_email)) <> lower(v_effective_admin_email) THEN
                RAISE EXCEPTION 'Admin actor email does not match the canonical profile email.';
            END IF;
            v_effective_admin_email := COALESCE(
                v_effective_admin_email,
                NULLIF(btrim(p_admin_email), '')
            );
        END IF;
    ELSE
        v_effective_admin_id := auth.uid();
        IF v_effective_admin_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required for bulk admin operation.';
        END IF;
        IF p_admin_id IS DISTINCT FROM v_effective_admin_id THEN
            RAISE EXCEPTION 'Admin actor ID does not match authenticated user.';
        END IF;
        SELECT NULLIF(btrim(p.email), '') INTO v_effective_admin_email
        FROM public.profiles p WHERE p.id = v_effective_admin_id;
        IF v_effective_admin_email IS NULL THEN
            v_effective_admin_email := NULLIF(btrim(auth.jwt() ->> 'email'), '');
        END IF;
        IF p_admin_email IS NOT NULL AND v_effective_admin_email IS NOT NULL
           AND lower(btrim(p_admin_email)) <> lower(v_effective_admin_email) THEN
            RAISE EXCEPTION 'Admin actor email does not match authenticated user.';
        END IF;
    END IF;
    IF v_effective_admin_id IS NULL THEN
        RAISE EXCEPTION 'Bulk admin operation requires an explicit auditable actor ID.';
    END IF;
$guard$;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.execute_bulk_ban_atomic(uuid,text,text)',
        'public.execute_bulk_unban_atomic(uuid,text)',
        'public.execute_bulk_restrict_atomic(uuid,text,text)',
        'public.execute_bulk_unrestrict_atomic(uuid,text)'
    ]
    LOOP
        SELECT pg_get_functiondef(to_regprocedure(v_signature))
          INTO v_definition;
        IF v_definition IS NULL THEN
            RAISE EXCEPTION 'Required bulk admin RPC not found: %', v_signature;
        END IF;
        IF position('v_effective_admin_id' in v_definition) > 0
           OR position('v_effective_admin_email' in v_definition) > 0 THEN
            RAISE EXCEPTION 'Refusing to patch % twice; inspect current function first', v_signature;
        END IF;

        v_body_start := strpos(v_definition, 'AS $function$');
        v_delimiter := '$function$';
        IF v_body_start = 0 THEN
            v_body_start := strpos(v_definition, 'AS $$');
            v_delimiter := '$$';
        END IF;
        IF v_body_start = 0 THEN
            RAISE EXCEPTION 'Unexpected function body delimiter for %', v_signature;
        END IF;

        v_prefix := substring(v_definition from 1 for v_body_start + length('AS ' || v_delimiter) - 1);
        v_body := substring(v_definition from v_body_start + length('AS ' || v_delimiter));
        v_close_pos := strpos(v_body, v_delimiter);
        IF v_close_pos = 0 THEN
            RAISE EXCEPTION 'Missing closing body delimiter for %', v_signature;
        END IF;
        v_suffix := substring(v_body from v_close_pos);
        v_body := substring(v_body from 1 for v_close_pos - 1);

        IF v_body !~* 'DECLARE[[:space:]]' THEN
            RAISE EXCEPTION 'Expected DECLARE block not found in %', v_signature;
        END IF;
        v_body := regexp_replace(
            v_body,
            '(DECLARE[[:space:]]+)',
            'DECLARE' || chr(10) ||
            '    v_effective_admin_id UUID;' || chr(10) ||
            '    v_effective_admin_email TEXT;' || chr(10),
            'i'
        );

        -- Substitute only the original function body before injecting the guard.
        v_body := replace(v_body, 'p_admin_id', 'v_effective_admin_id');
        v_body := replace(v_body, 'p_admin_email', 'v_effective_admin_email');

        IF v_body !~* '[[:space:]]BEGIN[[:space:]]' THEN
            RAISE EXCEPTION 'Expected top-level BEGIN not found in %', v_signature;
        END IF;

        v_body := regexp_replace(
            v_body,
            '[[:space:]]BEGIN[[:space:]]',
            ' BEGIN' || chr(10) || v_guard || chr(10),
            'i'
        );

        v_patched := v_prefix || v_body || v_suffix;
        EXECUTE v_patched;
        RAISE NOTICE 'Hardened audit actor binding for %', v_signature;
    END LOOP;
END
$migration$;
