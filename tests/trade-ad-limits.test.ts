import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAdFiatLimits } from '../src/lib/trade-ad-limits';

test('accepts amounts inside inclusive stored ad limits and exact boundaries', () => {
  const ad = { min_limit: 100, max_limit: 500 };
  assert.equal(validateAdFiatLimits(ad, 100), null);
  assert.equal(validateAdFiatLimits(ad, 250), null);
  assert.equal(validateAdFiatLimits(ad, 500), null);
});

test('supports legacy min_amount/max_amount aliases and absent limits', () => {
  assert.equal(validateAdFiatLimits({ min_amount: '25', max_amount: '75' }, 50), null);
  assert.equal(validateAdFiatLimits({}, 1), null);
  assert.equal(validateAdFiatLimits({ min_limit: '', max_limit: '' }, 1), null);
  assert.match(validateAdFiatLimits({ min_limit: '', min_amount: 100 }, 99) || '', /outside/i);
  assert.match(validateAdFiatLimits({ max_limit: '', max_amount: 50 }, 51) || '', /outside/i);
});

test('rejects fiat amounts outside stored limits', () => {
  assert.match(validateAdFiatLimits({ min_limit: 100 }, 99) || '', /outside/i);
  assert.match(validateAdFiatLimits({ max_limit: 500 }, 501) || '', /outside/i);
});

test('fails closed for invalid or contradictory ad limits', () => {
  assert.match(validateAdFiatLimits({ min_limit: 'not-a-number' }, 200) || '', /minimum limit is invalid/i);
  assert.match(validateAdFiatLimits({ max_limit: 0 }, 200) || '', /maximum limit is invalid/i);
  assert.match(validateAdFiatLimits({ min_limit: 500, max_limit: 100 }, 200) || '', /misconfigured/i);
});

test('rejects non-finite or non-positive calculated fiat amounts', () => {
  assert.match(validateAdFiatLimits({}, 0) || '', /numeric range/i);
  assert.match(validateAdFiatLimits({}, Number.NaN) || '', /numeric range/i);
  assert.match(validateAdFiatLimits({}, Number.POSITIVE_INFINITY) || '', /numeric range/i);
});
