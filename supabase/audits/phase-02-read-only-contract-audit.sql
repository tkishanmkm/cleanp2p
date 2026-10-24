-- Phase 02 read-only schema/security contract audit.
-- Safe for catalog inspection only: this file contains SELECT statements and makes no changes.

-- 1) Columns for financial and deposit tables.
SELECT table_name, ordinal_position, column_name, data_type, udt_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'wallets', 'wallet_assets', 'ledger_entries',
    'onchain_withdrawals', 'withdrawals', 'deposits',
    'deposit_addresses', 'user_deposit_addresses'
  )
ORDER BY table_name, ordinal_position;

-- 2) Relevant RPC signatures, result types, security mode, and effective EXECUTE grants.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_deposit_atomic', 'credit_deposit_atomic', 'credit_confirmed_deposit',
    'request_withdrawal', 'process_failed_withdrawal',
    'admin_resolve_dispute', 'finalize_p2p_release',
    'complete_trade', 'complete_trade_atomic',
    'lock_escrow', 'initiate_p2p_trade'
  )
ORDER BY p.proname, identity_arguments;

-- 3) Public tables/views without RLS or without any policies.
-- Views require separate review; ordinary RLS assumptions do not automatically secure views.
SELECT
  c.relname AS relation_name,
  c.relkind AS relation_kind,
  c.relrowsecurity AS rls_enabled,
  c.reloptions AS relation_options,
  count(pol.oid) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policy pol ON pol.polrelid = c.oid
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm')
GROUP BY c.relname, c.relkind, c.relrowsecurity, c.reloptions
HAVING NOT c.relrowsecurity OR count(pol.oid) = 0
ORDER BY c.relname;

-- 4) SECURITY DEFINER functions that are effectively executable by API roles.
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('public', p.oid, 'EXECUTE')
  )
ORDER BY p.proname, identity_arguments;

-- 5) Migration history is maintained in the Supabase project; inspect it separately
-- with the Supabase migration list tool. Do not write migration history through this audit.
