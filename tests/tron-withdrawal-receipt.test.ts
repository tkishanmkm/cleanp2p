import assert from 'node:assert/strict';
import { classifyTronReceiptResult } from '../src/lib/blockchain/tronReceiptStatus';

const cases: Array<[unknown, 'success' | 'failure' | 'pending']> = [
  ['SUCCESS', 'success'],
  [' success ', 'success'],
  ['REVERT', 'failure'],
  ['OUT_OF_ENERGY', 'failure'],
  ['TRANSFER_FAILED', 'failure'],
  ['unknown-provider-status', 'pending'],
  ['', 'pending'],
  [null, 'pending'],
  [undefined, 'pending'],
  [42, 'pending'],
];

for (const [input, expected] of cases) {
  assert.equal(classifyTronReceiptResult(input), expected, `receipt result: ${String(input)}`);
}

console.log(`TRON receipt classification: ${cases.length} cases passed.`);
