import assert from 'node:assert/strict';
import { parseWithdrawalAmount } from '../src/lib/withdrawalAmount';

const valid: Array<[number | string, number]> = [
  ['1', 1],
  ['0.000001', 0.000001],
  ['001.2300', 1.23],
  [' 12.5 ', 12.5],
  ['.25', 0.25],
  ['1.', 1],
  [1000, 1000],
  [0.5, 0.5],
];

for (const [input, expected] of valid) {
  assert.equal(parseWithdrawalAmount(input), expected, `valid amount: ${String(input)}`);
}

const invalid: Array<number | string> = [
  '1.25junk',
  '1junk',
  '1e3',
  '+1',
  '-1',
  '1,000',
  '',
  '   ',
  'NaN',
  'Infinity',
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

for (const input of invalid) {
  assert.ok(Number.isNaN(parseWithdrawalAmount(input)), `invalid amount rejected: ${String(input)}`);
}

assert.ok(parseWithdrawalAmount('0') === 0, 'zero is parsed but rejected by the service positive-amount guard');
console.log(`Withdrawal amount parser: ${valid.length} valid cases and ${invalid.length} invalid cases passed.`);
