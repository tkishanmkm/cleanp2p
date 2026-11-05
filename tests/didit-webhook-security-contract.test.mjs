import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/webhooks/didit/route.ts', 'utf8');

test('webhook refuses missing privileged configuration and disables persisted SDK sessions', () => {
  assert.match(source, /if \(!supabaseUrl \|\| !serviceRoleKey\)\s*\{\s*throw new Error\('Didit webhook Supabase configuration is missing'\)/);
  assert.match(source, /persistSession:\s*false/);
  assert.match(source, /autoRefreshToken:\s*false/);
  assert.match(source, /detectSessionInUrl:\s*false/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
});

test('webhook streams and bounds the request body before parsing JSON', () => {
  assert.match(source, /MAX_DIDIT_WEBHOOK_BYTES\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /readRequestBodyBounded\(req\)/);
  assert.match(source, /totalBytes\s*>\s*MAX_DIDIT_WEBHOOK_BYTES/);
  assert.match(source, /Webhook payload too large[\s\S]{0,80}status:\s*413/);
  assert.ok(source.indexOf('readRequestBodyBounded(req)') < source.indexOf('JSON.parse(raw)'));
});

test('webhook requires a fresh timestamp bound to the signed payload', () => {
  assert.match(source, /!tsHeader \|\| !\/\^\\d\{10\}\(\?:\\\.\\d\{1,3\}\)\?\$\//);
  assert.match(source, /Math\.abs\(Date\.now\(\) \/ 1000 - ts\) > 300/);
  assert.match(source, /String\(bodyTimestamp\) !== tsHeader\.trim\(\)/);
});

test('V2 canonical HMAC and V1 raw-body HMAC are validated independently', () => {
  assert.match(source, /x-signature-v2/);
  assert.match(source, /x-signature/);
  assert.match(source, /createHmac\('sha256', webhookSecret\)[\s\S]*?update\(canonicalV2, 'utf8'\)/);
  assert.match(source, /createHmac\('sha256', webhookSecret\)[\s\S]*?update\(raw, 'utf8'\)/);
  assert.match(source, /const validV2 = matchesHmacHex\(sigV2, expectedV2\)/);
  assert.match(source, /const validV1 = matchesHmacHex\(sigV1, expectedV1\)/);
  assert.match(source, /crypto\.timingSafeEqual\(expected, supplied\)/);
  assert.match(source, /if \(!validV2 && !validV1\)/);
});

test('webhook derives ownership from registered session and rejects payload mismatch', () => {
  assert.match(source, /Session is not registered to exactly one user/);
  assert.match(source, /String\(payloadUserId\) !== userId/);
  assert.match(source, /Unable to verify registered session ownership/);
  assert.match(source, /kycBySession\.data\.length !== 1/);
});

test('provider identity fields are bounded and duplicate filters are parameterized', () => {
  assert.match(source, /safeProviderText\(value: unknown, maxLength: number\)/);
  assert.match(source, /\.eq\('id_document_number', documentNumber\)/);
  assert.match(source, /\.eq\('full_name', extractedFullName\)/);
  assert.match(source, /\.eq\('date_of_birth', extractedDob\)/);
  assert.doesNotMatch(source, /duplicateQuery\.or\(/);
});

test('KYC approval requires a valid date-only DOB and computes age in UTC', () => {
  assert.match(source, /function getAgeFromDateOnly\(/);
  assert.match(source, /getUTCFullYear\(\)/);
  assert.match(source, /getUTCMonth\(\)/);
  assert.match(source, /getUTCDate\(\)/);
  assert.match(source, /A valid date of birth is required for KYC approval/);
  assert.match(source, /if \(age < 18\)/);
});
