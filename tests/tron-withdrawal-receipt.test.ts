import assert from 'node:assert/strict';
import { classifyTronReceiptResult } from '../src/lib/blockchain/tronReceiptStatus';
import { parseUnitsTron } from '../src/lib/blockchain/tron';

const cases: Array<[unknown, 'success' | 'failure' | 'pending']> = [
  ['SUCCESS', 'success'],
  [' success ', 'success'],
  ['REVERT', 'failure'],
  ['OUT_OF_ENERGY', 'failure'],
  ['TRANSFER_FAILED', 'failure'],
  ['UNKNOWN', 'pending'],
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

const amountCases: Array<[string | number, number, bigint]> = [
  ['1', 6, 1_000_000n],
  ['0.1', 6, 100_000n],
  ['001.230000', 6, 1_230_000n],
  ['0.000001', 6, 1n],
  ['1.23', 2, 123n],
];

for (const [amount, decimals, expected] of amountCases) {
  assert.equal(parseUnitsTron(amount, decimals), expected, `amount: ${String(amount)}`);
}

for (const amount of ['-1', '+1', '1e3', '1.0000001', '1,000', '', 'abc', '1.']) {
  assert.throws(() => parseUnitsTron(amount, 6), undefined, `invalid amount: ${amount}`);
}

assert.throws(() => parseUnitsTron('1', -1), /decimal precision/);
assert.throws(() => parseUnitsTron('1', 31), /decimal precision/);

console.log(`TRON amount parsing: ${amountCases.length} valid cases and 10 invalid cases passed.`);
