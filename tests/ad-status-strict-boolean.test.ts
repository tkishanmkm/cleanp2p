import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const route = readFileSync(path.join(process.cwd(), 'src/app/api/ads/[adId]/route.ts'), 'utf8');
const patchStart = route.indexOf('export async function PATCH(');
const putStart = route.indexOf('export async function PUT(', patchStart);
const patch = route.slice(patchStart, putStart);
assert.ok(patch.includes("typeof body.active !== 'boolean'"), 'PATCH must reject non-boolean active values rather than coercing strings such as "false" to true');
assert.ok(patch.includes('isActive = body.active;'), 'PATCH must preserve validated boolean values');
assert.ok(patch.includes("{ status: 400 }"), 'invalid active values must return HTTP 400');
console.log('PASS: ad status PATCH rejects ambiguous active values');
