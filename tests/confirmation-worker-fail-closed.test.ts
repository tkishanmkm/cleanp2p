import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');

assert.match(source, /status:\s*'VERIFICATION_REQUIRED'/);
assert.match(source, /deposit credit RPC was not called/);
assert.doesNotMatch(source, /\.rpc\(['"]process_deposit_atomic['"]/);
assert.match(source, /receipt\.status !== 1/);
assert.match(source, /tip - status\.block_height \+ 1/);

console.log('confirmation worker fail-closed source assertions passed (5 assertions)');
