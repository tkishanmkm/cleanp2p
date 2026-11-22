-- Restrict client-readable platform controls to the three boolean gates
-- consumed by middleware. Every other system_settings key remains server-only.
BEGIN;

DO $preflight$
DECLARE
    v_columns INTEGER;
    v_rls BOOLEAN;
BEGIN
    SELECT COUNT(*)
      INTO v_columns
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'system_settings'
       AND (
           (column_name = 'key' AND data_type = 'text' AND is_nullable = 'NO')
           OR (column_name = 'value' AND data_type = 'jsonb' AND is_nullable = 'NO')
           OR (column_name = 'updated_at' AND data_type = 'timestamp with time zone')
       );
    IF v_columns <> 3 THEN
        RAISE EXCEPTION 'system_settings schema does not match the expected key/value/updated_at contract.';
    END IF;

    SELECT c.relrowsecurity
      INTO v_rls
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'system_settings'
       AND c.relkind = 'r';
    IF v_rls IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Row-level security must be enabled on public.system_settings.';
    END IF;
END;
$preflight$;

DROP POLICY IF EXISTS "No public access" ON public.system_settings;
DROP POLICY IF EXISTS "system_settings_select_policy" ON public.system_settings;
DROP POLICY IF EXISTS "system_settings_admin_mutate_policy" ON public.system_settings;

CREATE POLICY "Public can read platform gate flags only"
ON public.system_settings
FOR SELECT
TO anon, authenticated
USING (
    key IN ('emergency_mode', 'maintenance_mode', 'prevent_user_login')
    AND jsonb_typeof(value) = 'boolean'
);

-- All current server mutations use the service-role client or owner-executed
-- security-definer RPCs. Browser roles have no reason to write platform gates.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.system_settings
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.system_settings TO anon, authenticated;

DO $postflight$
DECLARE
    v_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'system_settings'
       AND policyname = 'Public can read platform gate flags only'
       AND cmd = 'SELECT'
       AND roles @> ARRAY['anon', 'authenticated']::name[]
       AND qual LIKE '%emergency_mode%'
       AND qual LIKE '%maintenance_mode%'
       AND qual LIKE '%prevent_user_login%'
       AND qual LIKE '%jsonb_typeof%';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Public platform gate policy failed its postflight check.';
    END IF;
END;
$postflight$;

COMMIT;
