import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/workers/confirmations/route.ts', 'utf8');
const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');
assert.match(route, /code:\s*'VERIFICATION_REQUIRED'/);
assert.match(route, /depositCreditingEnabled:\s*false/);
assert.match(route, /Confirmation diagnostics completed only/);
assert.match(worker, /deposit credit RPC was not called/);
assert.doesNotMatch(worker, /\.rpc\(['"]process_deposit_atomic['"]/);
console.log('confirmation route diagnostic-only source assertions passed (5 assertions)');
