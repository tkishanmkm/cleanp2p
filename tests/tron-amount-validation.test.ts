import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUnitsTron } from '../src/lib/blockchain/tron';

test('converts supported TRON decimal amounts exactly', () => {
  assert.equal(parseUnitsTron('1').toString(), '1000000');
  assert.equal(parseUnitsTron('1.123456').toString(), '1123456');
  assert.equal(parseUnitsTron('0002.5').toString(), '2500000');
  assert.equal(parseUnitsTron('0.000001').toString(), '1');
});

test('rejects zero, negative, signed, and malformed amounts', () => {
  for (const amount of ['0', '0.000000', '-1', '-0.5', '+1', '', '1e-6', 'NaN', 'Infinity']) {
    assert.throws(() => parseUnitsTron(amount), undefined, `expected rejection for ${JSON.stringify(amount)}`);
  }
});

test('rejects excess decimal precision instead of truncating', () => {
  assert.throws(() => parseUnitsTron('1.1234567'), /exceeds supported precision/i);
});

test('rejects invalid token precision configuration', () => {
  for (const decimals of [-1, 1.5, 19, Number.NaN]) {
    assert.throws(() => parseUnitsTron('1', decimals), /invalid token decimal precision/i);
  }
});
