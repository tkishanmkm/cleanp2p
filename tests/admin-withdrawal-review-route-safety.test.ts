import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const route = readFileSync('src/app/api/admin/withdrawals/review/route.ts', 'utf8');
assert.match(route, /verifyServerAdmin/, 'admin review route must authenticate an authorized server admin');
assert.match(route, /typeof withdrawalId !== 'string' \|\| !withdrawalId\.trim\(\)/,
  'route rejects missing, non-string, and empty withdrawal IDs');
assert.match(route, /Withdrawal approval failed; review the withdrawal status before retrying/,
  'approval RPC errors use a generic response');
assert.match(route, /Withdrawal rejection failed; reconciliation may be required/,
  'refund RPC errors use a generic response');
assert.doesNotMatch(route, /error:\s*rpcError\.message/,
  'raw RPC errors are not returned to clients');
assert.match(route, /Unexpected request failure:[\s\S]*?Internal server error/,
  'unexpected exceptions are logged and sanitized');
assert.match(route, /rpcData\.success !== true/,
  'approval only returns success when the authoritative RPC confirms success');
console.log('PASS: admin withdrawal review route safety checks.');
