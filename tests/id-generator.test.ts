import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateAdId, generateTradeId, generate12CharId } from '../src/lib/id-generator';

const generatorSource = readFileSync(join(process.cwd(), 'src/lib/id-generator.ts'), 'utf8');
assert.match(generatorSource, /crypto\.getRandomValues/);
assert.match(generatorSource, /Cryptographically secure randomness is unavailable/);
assert.match(generatorSource, /Rejection sampling avoids modulo bias/);
assert.doesNotMatch(generatorSource, /Math\.random\s*\(/, 'ID generation must not fall back to Math.random');

const adIds = Array.from({ length: 1000 }, () => generateAdId());
const tradeIds = Array.from({ length: 1000 }, () => generateTradeId());

for (const id of adIds) {
  assert.match(id, /^AD[A-Z0-9]{10}$/, 'advertisement IDs must be 12 uppercase alphanumeric characters with AD prefix');
}
for (const id of tradeIds) {
  assert.match(id, /^TR[A-Z0-9]{10}$/, 'trade IDs must be 12 uppercase alphanumeric characters with TR prefix');
}

assert.equal(new Set(adIds).size, adIds.length, 'generated advertisement IDs must be unique in this sample');
assert.equal(new Set(tradeIds).size, tradeIds.length, 'generated trade IDs must be unique in this sample');

const mixedCaseId = generate12CharId();
assert.match(mixedCaseId, /^[0-9A-Za-z]{12}$/, 'generic IDs must retain the 12-character alphanumeric format');

console.log('ID generator format and sample-collision checks: PASS');
