import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/app/api/webhooks/didit/route.ts', 'utf8');

test('Didit webhook requires server-only Supabase configuration and disables persisted SDK sessions', () => {
  assert.match(source, /const supabaseUrl = process\.env\.NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\)/);
  assert.match(source, /const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY\?\.trim\(\)/);
  assert.match(source, /if \(!supabaseUrl \|\| !serviceRoleKey\)/);
  assert.doesNotMatch(source, /placeholder\.supabase\.co|placeholder-key/);
  assert.match(source, /autoRefreshToken:\s*false/);
  assert.match(source, /persistSession:\s*false/);
  assert.match(source, /detectSessionInUrl:\s*false/);
});

test('Didit webhook bounds the streamed body before JSON parsing', () => {
  assert.match(source, /MAX_DIDIT_WEBHOOK_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /readRequestBodyBounded\(req\)/);
  assert.match(source, /req\.body\?\.getReader\(\)/);
  assert.match(source, /totalBytes\s*>\s*MAX_DIDIT_WEBHOOK_BYTES/);
  assert.match(source, /Webhook payload too large[\s\S]{0,100}status:\s*413/);
  assert.ok(source.indexOf('readRequestBodyBounded(req)') < source.indexOf('JSON.parse(raw)'));
});

test('Didit webhook requires integer Unix seconds, freshness, and signed-body/header equality', () => {
  assert.match(source, /!\/\^\\d\{10\}\$\/.test\(tsHeader\.trim\(\)\)/);
  assert.match(source, /Number\.isSafeInteger\(ts\)/);
  assert.match(source, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\) > 300/);
  assert.match(source, /const bodyTimestamp = parsed && typeof parsed === 'object' \? parsed\.timestamp : undefined/);
  assert.match(source, /String\(bodyTimestamp\) !== tsHeader\.trim\(\)/);
});

test('Didit webhook verifies V2 canonical JSON or V1 raw bytes with constant-time HMAC comparison', () => {
  assert.match(source, /const canonicalV2 = JSON\.stringify\(sortKeys\(shortenFloats\(parsed\)\)\)/);
  assert.match(source, /\.createHmac\('sha256', webhookSecret\)/);
  assert.match(source, /crypto\.timingSafeEqual\(expected, supplied\)/);
  assert.match(source, /matchesHmacHex\(sigV2, expectedV2\)/);
  assert.match(source, /matchesHmacHex\(sigV1, expectedV1\)/);
  assert.match(source, /if \(!validV2 && !validV1\)/);
});

test('Didit webhook binds each event to one registered account and uses durable idempotency', () => {
  assert.match(source, /registeredOwners\.size !== 1/);
  assert.match(source, /claim_didit_webhook_event/);
  assert.match(source, /apply_didit_webhook_state/);
  assert.match(source, /claimResult\.status === 'duplicate'/);
  assert.match(source, /claimResult\.status === 'conflict'/);
});

console.log('PASS: Didit webhook security contract checks passed.');
