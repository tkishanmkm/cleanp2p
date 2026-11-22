import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const protectedRoutes = [
  'src/app/api/workers/withdrawals/route.ts',
  'src/app/api/workers/deposit-sweep/route.ts',
  'src/app/api/workers/confirmations/route.ts',
  'src/app/api/cron/update-prices/route.ts',
  'src/app/api/cron/sweeper/route.ts',
  'src/app/api/cron/reconcile/route.ts',
  'src/app/api/cron/indexer/route.ts',
  'src/app/api/cron/expire-trades/route.ts',
];

test('first-party worker and cron endpoints never accept secrets from query strings', () => {
  for (const path of protectedRoutes) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /verifyWorkerAuth/ , `${path} must use the shared fail-closed authenticator`);
    assert.doesNotMatch(source, /checkQueryParam:\s*true/, `${path} must not accept URL query credentials`);
  }
});
