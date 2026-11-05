-- PAXONES withdrawal refund reconciliation preflight
-- READ ONLY: execute in Supabase SQL Editor only after selecting the intended project.
-- This file intentionally contains SELECTs only. It does not apply migrations or mutate data.
-- Run first against production in read-only review mode, then against a disposable staging DB
-- after its schema is initialized from a separately reconciled migration chain.

-- 1. Identify database/project context without reading application secrets or user data.
SELECT current_database() AS database_name,
       current_user AS execution_role,
       current_setting('server_version') AS postgres_version,
       current_setting('search_path') AS search_path;

-- 2. Show all overloads and exact deployed signatures for the refund RPC.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_function_arguments(p.oid) AS arguments_with_defaults,
       pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       p.proconfig AS function_settings,
       pg_get_userbyid(p.proowner) AS owner,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'process_failed_withdrawal',
      'record_withdrawal_broadcast',
      'record_ambiguous_withdrawal_broadcast'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

-- 3. Confirm actual columns and types in both withdrawal records and wallet liability rows.
SELECT table_schema,
       table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('onchain_withdrawals', 'withdrawals', 'wallet_assets')
ORDER BY table_name, ordinal_position;

-- 4. Inspect check constraints on the affected tables; no row data is returned.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype AS constraint_type,
       con.convalidated AS is_validated,
       pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('onchain_withdrawals', 'withdrawals', 'wallet_assets')
ORDER BY c.relname, con.conname;

-- 5. Inspect indexes and uniqueness relevant to withdrawal identity and idempotency.
SELECT schemaname,
       tablename,
       indexname,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('onchain_withdrawals', 'withdrawals', 'wallet_assets', 'ledger_entries')
ORDER BY tablename, indexname;

-- 6. Inspect effective EXECUTE grants for every refund RPC overload.
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       grantee.rolname AS grantee,
       privilege.privilege_type,
       privilege.is_grantable
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS privilege
JOIN pg_roles grantee ON grantee.oid = privilege.grantee
WHERE n.nspname = 'public'
  AND p.proname IN (
      'process_failed_withdrawal',
      'record_withdrawal_broadcast',
      'record_ambiguous_withdrawal_broadcast'
  )
  AND privilege.privilege_type = 'EXECUTE'
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid), grantee.rolname;

-- 7. Inspect relevant migration ledger shape and recent entries, if present.
-- The DO block is deliberately avoided because this is a read-only review script and the
-- ledger's actual table name varies by Supabase/migration setup. Discover ledger tables first.
SELECT table_schema,
       table_name
FROM information_schema.tables
WHERE table_schema IN ('public', 'supabase_migrations')
  AND (table_name ILIKE '%migration%' OR table_name ILIKE '%schema_migrations%')
ORDER BY table_schema, table_name;

-- 8. No withdrawal/user/balance records are selected here by design. Do not paste secrets,
-- transaction signing keys, auth tokens, or personal financial rows into audit reports.
