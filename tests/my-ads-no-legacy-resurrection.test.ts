import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(path.join(process.cwd(), 'src/app/api/p2p/my-ads/route.ts'), 'utf8');
assert.ok(route.includes('if (ads.length === 0 && queryError)'), 'legacy admin fallback must only run after a query error, not a valid empty canonical result');
console.log('PASS: empty canonical ad results cannot resurrect stale legacy ads through admin fallback');