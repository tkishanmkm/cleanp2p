import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261020190000_withdrawal_reconciliation_candidates.sql',
  'utf8'
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.list_stale_withdrawal_reconciliation_candidates/i);
assert.match(migration, /FULL OUTER JOIN public\.withdrawals AS w ON w\.id = o\.id/i,
  'candidate scan must compare paired records and expose missing companion rows');
assert.match(migration, /o\.id IS NULL\s+OR w\.id IS NULL/i,
  'candidate scan must surface orphaned withdrawal records for manual reconciliation');
assert.match(migration, /o\.tx_hash IS DISTINCT FROM w\.tx_hash/i,
  'candidate scan must surface mismatched transaction hashes');
assert.match(migration, /w\.txid IS NOT NULL AND w\.txid IS DISTINCT FROM COALESCE\(w\.tx_hash, o\.tx_hash\)/i,
  'candidate scan must surface inconsistent txid/hash values');
assert.match(migration, /COALESCE\(LEAST\(o\.updated_at, w\.updated_at\), o\.updated_at, w\.updated_at\)\s+< NOW\(\) - make_interval/i,
  'candidate scan must only surface records stale past the configured threshold');
assert.match(migration, /p_min_age_minutes < 1 OR p_min_age_minutes > 10080/i,
  'age threshold must be bounded');
assert.match(migration, /REVOKE ALL ON FUNCTION public\.list_stale_withdrawal_reconciliation_candidates\(INTEGER\) FROM PUBLIC, anon, authenticated/i,
  'untrusted roles must not call reconciliation listing function');
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.list_stale_withdrawal_reconciliation_candidates\(INTEGER\) TO service_role, postgres/i,
  'only trusted service/database roles may inspect reconciliation candidates');
assert.doesNotMatch(migration, /\bUPDATE\s+public\.(onchain_withdrawals|withdrawals)\b/i,
  'reconciliation listing must not mutate financial state');
assert.doesNotMatch(migration, /\b(DELETE\s+FROM|INSERT\s+INTO)\s+public\.(onchain_withdrawals|withdrawals|ledger_entries)\b/i,
  'reconciliation listing must not delete records, create payouts, or write ledger entries');

console.log('PASS: withdrawal reconciliation candidate source contract checks.');
console.log('NOTE: static checks only; SQL compilation and row-level behavior require an isolated PostgreSQL test.');
