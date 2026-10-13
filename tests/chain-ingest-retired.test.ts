import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/internal/chain-ingest/route.ts', 'utf8');

assert.match(route, /code: 'CHAIN_INGEST_RETIRED'/);
assert.match(route, /depositsPaused: true/);
assert.match(route, /status: 410/);
assert.match(route, /Cache-Control': 'no-store'/);
assert.match(route, /independent, exact-event verification/);
assert.doesNotMatch(route, /process_deposit_atomic|process_user_deposit|credit_onchain_deposit|ingest_and_credit_deposit/);
assert.doesNotMatch(route, /getSupabaseAdminClient|createClient|\.rpc\(/);

console.log('internal chain-ingest retirement assertions passed (7 assertions)');
