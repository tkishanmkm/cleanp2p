import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(path.join(process.cwd(), 'src/app/api/ads/[adId]/route.ts'), 'utf8');
const putStart = route.indexOf('export async function PUT(');
assert.ok(putStart >= 0, 'PUT handler must exist');
const put = route.slice(putStart);

for (const [field, message] of [
  ['price', 'Price must be a finite number greater than 0.'],
  ['unitPrice', 'Unit price must be a finite number greater than 0.'],
  ['minAmount', 'Minimum limit must be a finite number greater than 0.'],
  ['maxAmount', 'Maximum limit must be a finite number greater than 0.'],
]) {
  assert.ok(put.includes(`!Number.isFinite(${field})`), `${field} must reject NaN and Infinity`);
  assert.ok(put.includes(message), `${field} should return a clear client validation message`);
}
assert.ok(put.includes('!Number.isFinite(margin) || margin < -50 || margin > 50'), 'dynamic pricing margin must reject NaN and out-of-range values');
console.log('PASS: ad edit API rejects non-finite numeric values before database writes');
