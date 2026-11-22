import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const route = readFileSync('src/app/api/withdraw/refund/route.ts', 'utf8');
assert.match(route, /typeof withdrawalId !== 'string' \|\| !withdrawalId\.trim\(\)/,
  'refund endpoint rejects missing, non-string, and empty withdrawal IDs');
assert.match(route, /Refund processing failed; reconciliation may be required/,
  'refund RPC errors use a sanitized response');
assert.doesNotMatch(route, /error:\s*`Refund processing failed:\s*\$\{rpcError\.message\}`/,
  'raw RPC messages are not returned to callers');
assert.match(route, /Unexpected refund request failure:[\s\S]*?Internal server error/,
  'unexpected errors are logged and sanitized');
assert.match(route, /verifyWorkerAuth/,
  'refund endpoint requires worker authentication');
console.log('PASS: refund route input validation and error sanitization checks.');
