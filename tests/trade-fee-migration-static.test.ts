import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20261015203000_restore_platform_trade_fee_accounting_legacy_schema.sql',
);
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.release_trade_escrow\(p_trade_id uuid, p_caller_id uuid DEFAULT NULL::uuid\)/i, 'expected legacy escrow RPC signature');
assert.match(sql, /SECURITY DEFINER/i, 'settlement RPC must retain SECURITY DEFINER');
assert.match(sql, /SET search_path TO 'public', 'pg_temp'/i, 'settlement RPC must pin search_path');
assert.match(sql, /v_trade\.seller_id !~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/i, 'seller UUID guard must be present');
assert.match(sql, /v_trade\.buyer_id !~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$'/i, 'buyer UUID guard must be present');
assert.match(sql, /IF COALESCE\(v_trade\.escrow_fee, 0\) < 0 THEN[\s\S]*?RAISE EXCEPTION 'Invalid negative escrow fee/i, 'negative fees must fail closed');
assert.match(sql, /'pf_p2pfee_' \|\| p_trade_id::TEXT/i, 'fee ledger idempotency key must be deterministic');
assert.match(sql, /Financial state corruption: completed trade/i, 'completed positive-fee trades must verify fee ledger');
assert.match(sql, /Financial idempotency conflict/i, 'replay must validate the existing fee ledger row');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.release_trade_escrow\(uuid, uuid\) FROM PUBLIC/i, 'PUBLIC execute must be revoked');
assert.match(sql, /REVOKE ALL ON FUNCTION public\.release_trade_escrow\(uuid, uuid\) FROM anon, authenticated/i, 'anon/authenticated execute must be revoked');
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.release_trade_escrow\(uuid, uuid\) TO service_role/i, 'service_role execute must be granted');
assert.match(sql.trimEnd(), /COMMIT;$/, 'migration must end with COMMIT');

const uuidGuard = sql.indexOf('v_trade.seller_id !~*');
const firstWalletOperation = sql.indexOf('-- 3. Lock Wallet Assets');
assert.ok(uuidGuard >= 0 && firstWalletOperation > uuidGuard, 'participant UUID guards must precede wallet operations');
const negativeFeeGuard = sql.indexOf("RAISE EXCEPTION 'Invalid negative escrow fee");
assert.ok(negativeFeeGuard >= 0 && negativeFeeGuard < firstWalletOperation, 'negative fee guard must precede wallet operations');

console.log('Trade-fee migration static regression checks passed. These checks do not compile or execute SQL against PostgreSQL.');
