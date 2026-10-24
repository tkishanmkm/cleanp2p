import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
assert.match(source, /Deposit crediting is paused until exact-event independent chain verification/);
assert.match(source, /export async function runDepositIngestion/);
assert.match(source, /depositsCredited: 0/);
assert.match(source, /export async function refreshPendingDepositConfirmations/);
assert.doesNotMatch(source, /\.rpc\(['"]process_deposit_atomic['"]/);
assert.doesNotMatch(source, /scanEvmTokenDeposits\(/);
assert.doesNotMatch(source, /scanBtcDeposits\(/);
assert.doesNotMatch(source, /scanLtcDeposits\(/);
assert.doesNotMatch(source, /scanTronDeposits\(/);

console.log('deposit ingestion fail-closed source assertions passed (9 assertions)');
