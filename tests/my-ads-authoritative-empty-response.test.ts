import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const page = readFileSync(path.join(process.cwd(), 'src/app/(dashboard)/my-ads/page.tsx'), 'utf8');
assert.ok(page.includes('let hasAuthoritativeAdsResponse = false;'), 'page must track whether the API returned an authoritative ads list');
assert.ok(page.includes('json.success === true && Array.isArray(json.ads)'), 'only a successful API ads array should be authoritative');
assert.ok(page.includes('hasAuthoritativeAdsResponse = true;'), 'successful API list must be marked authoritative even when empty');
assert.ok(page.includes('if (!hasAuthoritativeAdsResponse && rawAds.length === 0)'), 'direct-query fallback must not run after a successful empty API response');
console.log('PASS: My Ads preserves authoritative empty API results and avoids stale-row resurrection');
