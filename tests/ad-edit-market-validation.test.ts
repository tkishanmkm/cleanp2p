import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const page = readFileSync('src/app/(dashboard)/ads/edit/[adId]/page.tsx', 'utf8');
const route = readFileSync('src/app/api/ads/[adId]/route.ts', 'utf8');

test('edit form does not invent a market price when no quote is available', () => {
  assert.match(page, /useState<number>\(0\)/);
  assert.doesNotMatch(page, /useState<number>\(1\.0\)/);
  assert.match(page, /currentMarketPrice > 0 \? currentMarketPrice/);
});

test('unchanged pricing terms do not block edits to terms, payment methods, or limits', () => {
  assert.match(page, /originalPricingRef\.current/);
  assert.match(page, /const pricingChanged = !originalPricing/);
  assert.match(page, /if \(pricingChanged && currentMarketPrice > 0\)/);
  assert.match(route, /const fixedPricingChanged = !existingWasFixed/);
  assert.match(route, /if \(fixedPricingChanged\) \{/);
});

test('changing a fixed price or trading pair still requires a market reference', () => {
  assert.match(page, /pricingChanged && currentMarketPrice <= 0/);
  assert.match(route, /if \(marketError \|\| !marketRow \|\| !marketRow\.price_in_fiat/);
  assert.match(route, /effectiveEditPrice < minAllowedPrice \|\| effectiveEditPrice > maxAllowedPrice/);
});
