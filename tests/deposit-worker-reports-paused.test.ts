import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/workers/deposit-worker/route.ts', 'utf8');
assert.match(route, /code: 'DEPOSIT_CREDITING_PAUSED'/);
assert.match(route, /depositsPaused: true/);
assert.match(route, /status: 503/);
assert.match(route, /Deposit ingestion is paused pending independent chain verification/);
assert.doesNotMatch(route, /Deposit ingestion completed via canonical process_deposit_atomic/);

const job = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
assert.match(job, /depositsCredited: 0/);
assert.match(job, /Deposit crediting is paused until exact-event independent chain verification/);
assert.doesNotMatch(job, /\.rpc\(['"]process_deposit_atomic['"]/);

console.log('deposit worker paused-status assertions passed (8 assertions)');

const indexer = readFileSync('src/app/api/cron/indexer/route.ts', 'utf8');
assert.match(indexer, /code: 'DEPOSIT_CREDITING_PAUSED'/);
assert.match(indexer, /depositsPaused: true/);
assert.match(indexer, /status: 503/);
assert.match(indexer, /Deposit indexing is paused pending independent chain verification/);
assert.doesNotMatch(indexer, /Multi-chain indexer executed successfully/);

console.log('cron indexer paused-status assertions passed (5 additional assertions)');
