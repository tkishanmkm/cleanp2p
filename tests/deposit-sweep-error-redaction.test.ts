import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/workers/deposit-sweep/route.ts', 'utf8');

// Auth failures must stop before importing or executing the sweeper.
assert.match(route, /if \(!auth\.authorized\)/);
assert.match(route, /status: 401/);
assert.ok(route.indexOf('if (!auth.authorized)') < route.indexOf("await import('@/jobs/sweeperWorker')"));

// Internal database/provider exception text must not be sent to the caller.
assert.match(route, /console\.error\('Deposit sweep GET error:', err\)/);
assert.match(route, /\{ error: 'Internal server error' \}/);
assert.doesNotMatch(route, /error:\s*err\.message/);
assert.doesNotMatch(route, /error:\s*err\?\.message/);

// Legacy direct-broadcast endpoint remains retired.
assert.match(route, /status: 410/);
assert.match(route, /decommissioned: true/);

console.log('deposit sweep error-redaction assertions passed (8 assertions)');
