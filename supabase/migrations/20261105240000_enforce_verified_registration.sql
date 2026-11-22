-- Enforce verified, adult, one-time registration at the auth.users trigger boundary.
-- The web validation endpoint issues only a short-lived proof after CAPTCHA and
-- identity checks. Auth-provider/OAuth account creation without that proof fails.
BEGIN;

CREATE TABLE IF NOT EXISTS public.registration_proofs (
    id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    proof_hash TEXT NOT NULL UNIQUE
        CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
    email_normalized TEXT NOT NULL
        CHECK (email_normalized = pg_catalog.lower(pg_catalog.btrim(email_normalized))),
    full_name_normalized TEXT NOT NULL
        CHECK (full_name_normalized = pg_catalog.lower(pg_catalog.btrim(full_name_normalized))),
    date_of_birth DATE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_registration_proofs_expiry
    ON public.registration_proofs (expires_at);

ALTER TABLE public.registration_proofs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon_authenticated_access ON public.registration_proofs;
CREATE POLICY deny_anon_authenticated_access
    ON public.registration_proofs
    FOR ALL TO anon, authenticated
    USING (false) WITH CHECK (false);

REVOKE ALL PRIVILEGES ON TABLE public.registration_proofs
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE OR REPLACE FUNCTION public.issue_registration_proof(
    p_proof_hash TEXT,
    p_email TEXT,
    p_full_name TEXT,
    p_date_of_birth DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_email TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, '')));
    v_name TEXT := pg_catalog.lower(pg_catalog.btrim(COALESCE(p_full_name, '')));
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Trusted registration validation is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_proof_hash IS NULL
       OR p_proof_hash !~ '^[0-9a-f]{64}$'
       OR v_email = ''
       OR pg_catalog.length(v_email) > 254
       OR v_name = ''
       OR pg_catalog.length(v_name) > 100
       OR p_date_of_birth IS NULL
       OR p_date_of_birth > (CURRENT_DATE - INTERVAL '18 years')::date THEN
        RAISE EXCEPTION 'Invalid registration proof issuance request.'
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.registration_proofs
     WHERE expires_at <= pg_catalog.clock_timestamp();

    INSERT INTO public.registration_proofs (
        proof_hash, email_normalized, full_name_normalized, date_of_birth, expires_at
    )
    VALUES (
        p_proof_hash, v_email, v_name, p_date_of_birth,
        pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
    );

    RETURN TRUE;
END;
$function$;

ALTER FUNCTION public.issue_registration_proof(TEXT, TEXT, TEXT, DATE)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.issue_registration_proof(TEXT, TEXT, TEXT, DATE)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.issue_registration_proof(TEXT, TEXT, TEXT, DATE)
    TO service_role, postgres;

DO $migration$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_old TEXT;
    v_new TEXT;
BEGIN
    v_oid := pg_catalog.to_regprocedure('public.handle_new_user()');
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required public.handle_new_user() trigger function is missing.';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_definition := pg_catalog.replace(v_definition, E'\r\n', E'\n');

    v_old := 'SET search_path TO ''public'', ''auth'', ''pg_temp''';
    IF pg_catalog.strpos(v_definition, v_old) = 0 THEN
        RAISE EXCEPTION 'Could not locate handle_new_user search_path; aborting.';
    END IF;
    v_definition := pg_catalog.replace(v_definition, v_old, 'SET search_path TO pg_catalog');

    v_old := E'    v_country TEXT;\nBEGIN';
    IF pg_catalog.strpos(v_definition, v_old) = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
            v_old
          ) > 0 THEN
        RAISE EXCEPTION 'Could not locate one unique handle_new_user declaration boundary; aborting.';
    END IF;

    v_new := E'    v_country TEXT;\n    v_registration_proof TEXT;\n    v_registration_proof_hash TEXT;\n    v_registration_email TEXT;\n    v_registration_name TEXT;\n    v_registration_proof_id UUID;\n    v_signup_control JSONB;\n    v_emergency_control JSONB;\n    v_maintenance_control JSONB;\nBEGIN\n\n    -- Enforce global signup controls inside the Auth transaction, not only in the UI.\n    SELECT value INTO v_signup_control FROM public.system_settings WHERE key = ''prevent_new_signups'' FOR SHARE;\n    SELECT value INTO v_emergency_control FROM public.system_settings WHERE key = ''emergency_mode'' FOR SHARE;\n    SELECT value INTO v_maintenance_control FROM public.system_settings WHERE key = ''maintenance_mode'' FOR SHARE;\n\n    IF v_signup_control IS NULL OR pg_catalog.jsonb_typeof(v_signup_control) IS DISTINCT FROM ''boolean''\n       OR v_emergency_control IS NULL OR pg_catalog.jsonb_typeof(v_emergency_control) IS DISTINCT FROM ''boolean''\n       OR v_maintenance_control IS NULL OR pg_catalog.jsonb_typeof(v_maintenance_control) IS DISTINCT FROM ''boolean'' THEN\n        RAISE EXCEPTION ''Registration is unavailable because platform controls cannot be verified.''\n            USING ERRCODE = ''55000'', DETAIL = ''PLATFORM_CONTROL_STATE_UNAVAILABLE'';\n    END IF;\n\n    IF v_signup_control = ''true''::jsonb OR v_emergency_control = ''true''::jsonb OR v_maintenance_control = ''true''::jsonb THEN\n        RAISE EXCEPTION ''New user registration is currently disabled by platform controls.''\n            USING ERRCODE = ''42501'', DETAIL = ''PLATFORM_SIGNUP_DISABLED'';\n    END IF;\n\n    -- OAuth/password signups must both present a proof issued after server-side CAPTCHA,\n    -- exact-name/DOB duplicate checking, and the 18+ policy check. Existing logins do not\n    -- insert auth.users and are unaffected by this trigger.\n    v_full_name := COALESCE(\n        NULLIF(TRIM(NEW.raw_user_meta_data->>''full_name''), ''''),\n        NULLIF(TRIM(NEW.raw_user_meta_data->>''name''), ''''),\n        NULLIF(TRIM(NEW.raw_user_meta_data->>''displayName''), ''''),\n        ''''\n    );\n    v_raw_dob := COALESCE(\n        NULLIF(TRIM(NEW.raw_user_meta_data->>''dob''), ''''),\n        NULLIF(TRIM(NEW.raw_user_meta_data->>''date_of_birth''), '''')\n    );\n    IF v_full_name = '''' OR pg_catalog.length(v_full_name) > 100\n       OR v_raw_dob IS NULL OR v_raw_dob !~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}$'' THEN\n        RAISE EXCEPTION ''A validated legal name and date of birth are required to register.''\n            USING ERRCODE = ''22023'', DETAIL = ''REGISTRATION_VALIDATION_REQUIRED'';\n    END IF;\n\n    BEGIN\n        v_dob := v_raw_dob::DATE;\n    EXCEPTION WHEN OTHERS THEN\n        RAISE EXCEPTION ''A valid date of birth is required to register.''\n            USING ERRCODE = ''22023'', DETAIL = ''INVALID_DATE_OF_BIRTH'';\n    END;\n    IF v_dob > (CURRENT_DATE - INTERVAL ''18 years'')::date THEN\n        RAISE EXCEPTION ''Users must be at least 18 years old to register.''\n            USING ERRCODE = ''42501'', DETAIL = ''UNDER_18_PROHIBITED'';\n    END IF;\n\n    v_registration_proof := NULLIF(TRIM(NEW.raw_user_meta_data->>''registration_proof''), '''');\n    v_registration_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.email, '''')));\n    v_registration_name := pg_catalog.lower(pg_catalog.btrim(v_full_name));\n    IF v_registration_proof IS NULL OR v_registration_proof !~ ''^[0-9a-f]{64}$''\n       OR v_registration_email = '''' THEN\n        RAISE EXCEPTION ''A valid one-time registration proof is required.''\n            USING ERRCODE = ''42501'', DETAIL = ''REGISTRATION_PROOF_REQUIRED'';\n    END IF;\n\n    v_registration_proof_hash := pg_catalog.encode(\n        pg_catalog.sha256(pg_catalog.convert_to(v_registration_proof, ''UTF8'')),\n        ''hex''\n    );\n    DELETE FROM public.registration_proofs\n     WHERE proof_hash = v_registration_proof_hash\n       AND email_normalized = v_registration_email\n       AND full_name_normalized = v_registration_name\n       AND date_of_birth = v_dob\n       AND expires_at > pg_catalog.clock_timestamp()\n     RETURNING id INTO v_registration_proof_id;\n    IF NOT FOUND THEN\n        RAISE EXCEPTION ''Registration proof is invalid, expired, mismatched, or already consumed.''\n            USING ERRCODE = ''42501'', DETAIL = ''REGISTRATION_PROOF_INVALID'';\n    END IF;\n\n    -- Continue the canonical profile/wallet-index provisioning below.';
    v_updated := pg_catalog.replace(v_definition, v_old, v_new);

    v_old := E'    RETURN NEW;';
    IF pg_catalog.strpos(v_updated, v_old) = 0
       OR pg_catalog.strpos(
            pg_catalog.substr(v_updated, pg_catalog.strpos(v_updated, v_old) + pg_catalog.length(v_old)),
            v_old
          ) > 0 THEN
        RAISE EXCEPTION 'Could not locate one unique handle_new_user return boundary; aborting.';
    END IF;

    v_new := E'    -- The one-time proof row was already consumed. Do not update auth.users\n    -- from its own AFTER INSERT trigger.\n    RETURN NEW;';
    v_updated := pg_catalog.replace(v_updated, v_old, v_new);

    IF pg_catalog.strpos(v_updated, 'registration_proof') = 0
       OR pg_catalog.strpos(v_updated, 'PLATFORM_SIGNUP_DISABLED') = 0
       OR pg_catalog.strpos(v_updated, 'UNDER_18_PROHIBITED') = 0
       OR pg_catalog.strpos(v_updated, 'SET search_path TO pg_catalog') = 0 THEN
        RAISE EXCEPTION 'handle_new_user registration proof patch failed verification; aborting.';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMENT ON TABLE public.registration_proofs IS
    'Private, short-lived, single-use proof records for adult, CAPTCHA-verified registrations; proofs are deleted atomically by the auth.users insert trigger.';

COMMIT;