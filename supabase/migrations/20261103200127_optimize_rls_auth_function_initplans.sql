BEGIN;

DO $migration$
DECLARE
  v_policy record;
  v_using text;
  v_check text;
  v_original_using text;
  v_original_check text;
  v_sql text;
BEGIN
  FOR v_policy IN
    SELECT p.polname,
           p.polrelid,
           n.nspname AS schema_name,
           c.relname AS table_name,
           p.polqual,
           p.polwithcheck
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  LOOP
    v_original_using := pg_catalog.pg_get_expr(v_policy.polqual, v_policy.polrelid);
    v_original_check := pg_catalog.pg_get_expr(v_policy.polwithcheck, v_policy.polrelid);
    v_using := v_original_using;
    v_check := v_original_check;

    IF v_using IS NOT NULL THEN
      v_using := pg_catalog.regexp_replace(v_using, '(?<!SELECT )auth[.]uid[(][)]', '(SELECT auth.uid())', 'g');
      v_using := pg_catalog.regexp_replace(v_using, '(?<!SELECT )auth[.]role[(][)]', '(SELECT auth.role())', 'g');
    END IF;

    IF v_check IS NOT NULL THEN
      v_check := pg_catalog.regexp_replace(v_check, '(?<!SELECT )auth[.]uid[(][)]', '(SELECT auth.uid())', 'g');
      v_check := pg_catalog.regexp_replace(v_check, '(?<!SELECT )auth[.]role[(][)]', '(SELECT auth.role())', 'g');
    END IF;

    IF v_using IS DISTINCT FROM v_original_using
       OR v_check IS DISTINCT FROM v_original_check THEN
      v_sql := pg_catalog.format(
        'ALTER POLICY %I ON %I.%I',
        v_policy.polname,
        v_policy.schema_name,
        v_policy.table_name
      );

      IF v_using IS NOT NULL THEN
        v_sql := v_sql || pg_catalog.format(' USING (%s)', v_using);
      END IF;

      IF v_check IS NOT NULL THEN
        v_sql := v_sql || pg_catalog.format(' WITH CHECK (%s)', v_check);
      END IF;

      EXECUTE v_sql;
    END IF;
  END LOOP;
END;
$migration$;

COMMIT;
