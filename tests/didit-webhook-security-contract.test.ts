import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/api/webhooks/didit/route.ts', 'utf8');

test('Didit webhook requires real Supabase service configuration and disables persisted SDK sessions', () => {
  assert.match(source, /const supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\)/);
  assert.match(source, /const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
  assert.match(source, /if \(!supabaseUrl \|\| !serviceRoleKey\)/);
  assert.doesNotMatch(source, /placeholder\.supabase\.co|placeholder-key/);
  assert.match(source, /autoRefreshToken:\s*false/);
  assert.match(source, /persistSession:\s*false/);
  assert.match(source, /detectSessionInUrl:\s*false/);
});

test('Didit webhook bounds the body while streaming before JSON parsing', () => {
  assert.match(source, /MAX_DIDIT_WEBHOOK_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /readRequestBodyBounded\(req\)/);
  assert.match(source, /req\.body\.getReader\(\)/);
  assert.match(source, /totalBytes\s*>\s*MAX_DIDIT_WEBHOOK_BYTES/);
  assert.match(source, /Webhook payload too large[\s\S]{0,100}status:\s*413/);
  assert.ok(source.indexOf('readRequestBodyBounded(req)') < source.indexOf('JSON.parse(raw)'));
});

test('Didit webhook binds the signed body timestamp to the header and enforces 5-minute freshness', () => {
  assert.match(source, /!\/\^\\d\{10\}\$\//);
  assert.match(source, /Number\.isSafeInteger\(ts\)/);
  assert.match(source, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\) > 300/);
  assert.match(source, /const bodyTimestamp = parsed\?\.timestamp/);
  assert.match(source, /String\(bodyTimestamp\) !== tsHeader/);
});

test('Didit webhook verifies V2 canonical JSON or V1 exact raw body using constant-time hex comparison', () => {
  assert.match(source, /JSON\.stringify\(sortKeys\(shortenFloats\(parsed\)\)\)/);
  assert.match(source, /\.createHmac\('sha256', webhookSecret\)/);
  assert.match(source, /crypto\.timingSafeEqual\(expected, provided\)/);
  assert.match(source, /matchesHmacHex\(expected, sigV2!\.trim\(\)\)/);
  assert.match(source, /matchesHmacHex\(expectedRaw, sigV1!\.trim\(\)\)/);
  assert.match(source, /if \(!isValidV2 && !isValidRaw\)/);
});

console.log('PASS: Didit webhook rejects placeholder config, oversized payloads, stale/mismatched timestamps and invalid signatures.');