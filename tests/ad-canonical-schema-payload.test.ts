import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const adRoute = readFileSync(path.join(root, 'src/app/api/ads/[adId]/route.ts'), 'utf8');
const toggleRoute = readFileSync(path.join(root, 'src/app/api/ads/[adId]/toggle/route.ts'), 'utf8');

const putStart = adRoute.indexOf('// 5a. Update Canonical p2p_ads Table (Authoritative)');
const putEnd = adRoute.indexOf('// 5b. Update Legacy ads Table Mirror', putStart);
assert.ok(putStart >= 0 && putEnd > putStart, 'canonical PUT payload section must exist');
const canonicalPut = adRoute.slice(putStart, putEnd);

for (const column of [
  'asset_symbol', 'crypto_currency', 'coin', 'fiat_symbol', 'fiat_currency',
  'price', 'min_limit', 'max_limit', 'margin', 'pricing_type',
  'payment_methods', 'payment_method', 'terms', 'type', 'ad_type',
  'min_completed_trades_req',
]) {
  assert.ok(canonicalPut.includes(`p2pPayload.${column}`), `canonical edit should map supported column ${column}`);
}

for (const column of [
  'updated_at', 'asset =', 'crypto =', 'fiat =', 'unit_price', 'fixed_rate',
  'min_amount', 'max_amount', 'available_amount', 'rate_percent',
  'price_margin', 'price_margin_percent', 'rate_type', 'terms_conditions',
  'offer_label', 'offer_tags', 'trade_type', 'require_full_name_verified',
  'require_verified_users', 'min_completed_trades =', 'payment_window',
  'payment_window_minutes', 'payment_time_limit',
]) {
  assert.ok(!canonicalPut.includes(`p2pPayload.${column}`), `unsupported canonical column must not be sent: ${column}`);
}

const legacyPutStart = adRoute.indexOf('// 5b. Update Legacy ads Table Mirror');
const legacyPutEnd = adRoute.indexOf("if (!p2pAdsRow && !adsRow)", legacyPutStart);
assert.ok(legacyPutStart >= 0 && legacyPutEnd > legacyPutStart, 'legacy PUT payload section must exist');
const legacyPut = adRoute.slice(legacyPutStart, legacyPutEnd);
for (const column of [
  'asset_symbol', 'asset', 'coin', 'crypto_currency', 'token_symbol',
  'fiat_symbol', 'fiat_currency', 'currency', 'unit_price', 'fixed_rate',
  'fixed_price', 'min_amount', 'max_amount', 'margin_percentage', 'rate_percent',
  'rate_adjustment', 'price_margin', 'margin_rate', 'pricing_type', 'price_type',
  'rate_type', 'is_fixed', 'payment_methods', 'terms', 'trade_type', 'payment_window',
  'payment_window_minutes', 'payment_time_limit', 'tags', 'ad_tags', 'targeted_countries',
  'blocked_countries', 'offer_label', 'label', 'require_full_name_verified',
  'require_verified_users', 'min_completed_trades',
]) {
  assert.ok(legacyPut.includes(`adsPayload.${column}`), `legacy edit should persist supported field ${column}`);
}
assert.ok(legacyPut.includes('if (paymentWindow !== undefined)'), 'omitted payment window must not reset to a default');
assert.ok(legacyPut.includes('if (rawTags !== undefined)'), 'omitted tags must not overwrite saved tags');
const deleteStart = adRoute.indexOf("// 4. Perform Soft-Delete & Deletion on independently resolved target IDs");
const deleteEnd = adRoute.indexOf("if (adsRow)", deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'canonical delete section must exist');
const canonicalDelete = adRoute.slice(deleteStart, deleteEnd);
for (const flag of ["status: 'DELETED'", 'active: false', 'is_active: false', 'is_deleted: true']) {
  assert.ok(canonicalDelete.includes(flag), `canonical soft-delete must set ${flag}`);
}

const mainPatchStart = adRoute.indexOf('export async function PATCH(');
const mainPatchEnd = adRoute.indexOf('export async function PUT(', mainPatchStart);
assert.ok(mainPatchStart >= 0 && mainPatchEnd > mainPatchStart, 'main ad PATCH handler must exist');
for (const [name, source] of [
  ['ad PATCH', adRoute.slice(mainPatchStart, mainPatchEnd)],
  ['toggle PATCH', toggleRoute],
] as const) {
  const updateStart = source.indexOf(".from('p2p_ads')");
  const updateEnd = source.indexOf(".select('id')", updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart, `${name} canonical update should exist`);
  const updateBlock = source.slice(updateStart, updateEnd);
  assert.ok(!updateBlock.includes('updated_at'), `${name} must not update nonexistent p2p_ads.updated_at`);
  assert.ok(updateBlock.includes('is_active: isActive'), `${name} must synchronize canonical active flags`);
  assert.ok(updateBlock.includes('active: isActive'), `${name} must update canonical active flag`);
}

console.log('PASS: canonical ad edit/status/delete payloads match the deployed p2p_ads schema');
