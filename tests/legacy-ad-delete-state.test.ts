import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(path.join(process.cwd(), 'src/app/api/ads/[adId]/route.ts'), 'utf8');
const legacyDeleteStart = route.indexOf(".from('ads')", route.indexOf('export async function DELETE'));
const legacyDeleteEnd = route.indexOf("if (!adsRow && !p2pAdsRow)", legacyDeleteStart);
const legacyDelete = route.slice(legacyDeleteStart, legacyDeleteEnd > legacyDeleteStart ? legacyDeleteEnd : route.indexOf('if (!p2pAdsRow && !adsRow)', legacyDeleteStart));
assert.ok(legacyDelete.includes("status: 'DELETED'"), 'legacy ad must be marked deleted');
assert.ok(legacyDelete.includes('active: false'), 'legacy ad must be deactivated');
assert.ok(legacyDelete.includes('is_active: false'), 'legacy ad must synchronize is_active');
assert.ok(legacyDelete.includes('is_deleted: true'), 'legacy ad must set its deletion flag');
console.log('PASS: legacy ad soft-delete disables all active flags and sets is_deleted');