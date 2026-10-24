import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source-level regression checks for fail-closed withdrawal dispatch.
// These checks are intentionally offline and do not access wallets or databases.
const source = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');

assert.match(
  source,
  /if \(error \|\| !settings\) \{\s*console\.error\('\[Withdrawal Worker\] Circuit-breaker settings unavailable; blocking withdrawal dispatch\.', error\);\s*return \{ allowed: false, reason: 'Withdrawal safety settings unavailable' \};\s*\}/,
  'Missing/error platform safety settings must block withdrawals'
);

assert.match(
  source,
  /catch \(err\) \{\s*console\.error\('\[Withdrawal Worker\] Circuit-breaker check failed; blocking withdrawal dispatch\.', err\);\s*return \{ allowed: false, reason: 'Withdrawal safety check failed' \};\s*\}/,
  'Circuit-breaker exceptions must block withdrawals'
);

assert.match(
  source,
  /if \(lockErr \|\| lockAcquired !== true\) \{[\s\S]*?refusing to process withdrawals/,
  'Withdrawal processing must stop unless distributed lock acquisition explicitly succeeds'
);

assert.match(
  source,
  /catch \(lockRpcErr\) \{[\s\S]*?refusing to process withdrawals/,
  'Lock RPC exceptions must stop withdrawal processing'
);

console.log('Withdrawal safety source regression checks passed (4 assertions).');
