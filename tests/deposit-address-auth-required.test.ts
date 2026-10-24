import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const singleRoute = readFileSync('src/app/api/wallet/deposit-address/route.ts', 'utf8');
assert.doesNotMatch(singleRoute, /headers\.get\(['"]x-user-id['"]\)/);
assert.doesNotMatch(singleRoute, /searchParams\.get\(['"]user_id['"]\)/);
assert.match(singleRoute, /auth\.getUser\(token\)/);
assert.match(singleRoute, /if \(!userId\)/);
assert.match(singleRoute, /status: 401/);

const pluralRoute = readFileSync('src/app/api/wallet/deposit-addresses/route.ts', 'utf8');
assert.doesNotMatch(pluralRoute, /searchParams\.get\(['"]user_id['"]\)/);
assert.doesNotMatch(pluralRoute, /deriveAllAddresses/);
assert.match(pluralRoute, /if \(!userId\)/);
assert.match(pluralRoute, /status: 401/);
assert.match(pluralRoute, /auth\.getUser\(token\)/);

console.log('deposit address identity assertions passed (10 assertions)');
