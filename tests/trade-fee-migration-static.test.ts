import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Static guard only: this verifies that the candidate migration preserves key
// safety properties in source. It does NOT execute SQL or replace DB integration tests.
const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261015130000_restore_p2p_trade_fee_ledger_on_release.sql'
);
const sql = readFileSync(migrationPath, 'utf8');

const releaseStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.release_trade_escrow');
assert.notEqual(releaseStart, -1, 'migration must redefine release_trade_escrow');
const releaseEnd = sql.indexOf('$$;', releaseStart + 3);
assert.notEqual(releaseEnd, -1, 'release function must terminate');
const releaseFn = sql.slice(releaseStart, releaseEnd + 3);

assert.match(releaseFn, /Caller ID mismatch: unauthorized impersonation\./,
  'caller identity mismatch guard must remain');
assert.match(releaseFn, /FROM public\.trades[\s\S]*?FOR UPDATE/,
  'trade row must be locked before settlement');
assert.match(releaseFn, /v_total_escrow := v_trade\.crypto_amount \+ COALESCE\(v_trade\.escrow_fee, 0\.0\)/,
  'total escrow must include fee');
assert.equal((releaseFn.match(/record_platform_ledger_entry\(/g) ?? []).length, 2,
  'fee helper must be used for settlement and completed-trade replay');
assert.equal((releaseFn.match(/'pf_p2pfee_' \|\| p_trade_id::TEXT/g) ?? []).length, 2,
  'settlement and replay must share deterministic fee idempotency key');
assert.match(releaseFn, /IF COALESCE\(v_trade\.escrow_fee, 0\) > 0 THEN[\s\S]*?p_entry_type := 'trade_fee_collected'/,
  'positive fee must create a platform fee ledger entry');
assert.match(releaseFn, /'completed'[\s\S]*?Already released \(idempotent success\)/,
  'completed-trade replay path must remain');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.release_trade_escrow\(UUID, UUID\) FROM PUBLIC, anon;/,
  'public and anon execute permissions must be revoked');
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.release_trade_escrow\(UUID, UUID\) TO authenticated, service_role, postgres;/,
  'intended execute grants must remain');
assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/,
  'migration must be transaction-wrapped');

console.log('PASS: escrow fee migration static safety checks');
console.log('NOTE: run integration tests against a fully initialized disposable Supabase project before deployment.');
