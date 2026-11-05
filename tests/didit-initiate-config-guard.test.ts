import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(process.cwd(), 'src', 'app', 'api', 'kyc', 'initiate', 'route.ts'),
  'utf8',
);

test('Didit configuration is required before KYC side effects', () => {
  const configGuard = source.indexOf("if (!apiKey || !workflowId)");
  const b2Write = source.indexOf('saveKycAddressToB2(');
  const profileSection = source.indexOf('// 3. Save user address details');
  const profileAddressWrite = source.indexOf('.update({', profileSection);
  assert.notEqual(configGuard, -1, 'missing provider config must fail closed');
  assert.notEqual(b2Write, -1);
  assert.notEqual(profileAddressWrite, -1);
  assert.ok(configGuard < b2Write, 'configuration guard must precede document storage');
  assert.ok(configGuard < profileAddressWrite, 'configuration guard must precede profile writes');
  assert.match(source, /status:\s*503/);
});

test('Didit workflow must come from deployment configuration, not a hard-coded fallback', () => {
  assert.match(source, /process\.env\.DIDIT_WORKFLOW_ID\?\.trim\(\)/);
  assert.doesNotMatch(source, /DIDIT_WORKFLOW_ID\s*\|\|\s*['"][0-9a-f-]{20,}['"]/i);
});

test('KYC registers only a valid HTTPS provider session through the atomic SQL RPC', () => {
  const sessionValidation = source.indexOf('typeof sessionId');
  const atomicRegistration = source.indexOf("supabase.rpc('initiate_didit_kyc'");
  assert.notEqual(sessionValidation, -1);
  assert.notEqual(atomicRegistration, -1);
  assert.ok(sessionValidation < atomicRegistration, 'provider session must validate before database registration');
  assert.match(source, /parsedSessionUrl\.protocol !== 'https:'/);
  assert.match(source, /trustedDiditHost/);
  assert.match(source, /sessionHost\.endsWith\('\.didit\.me'\)/);
  assert.match(source, /AbortSignal\.timeout\(15_000\)/);
  assert.match(source, /Verification provider rejected session request/);
  assert.doesNotMatch(source, /detail\s*,\s*\}\s*,\s*\{\s*status:\s*502/);
  assert.match(source, /initiationResult\.success !== true/);
  assert.doesNotMatch(source, /kyc_status: 'in_review'/);
  assert.doesNotMatch(source, /from\('kyc_verifications'\)\.insert/);
});

test('settings UI clearly reports unavailable KYC without pretending submission succeeded', () => {
  const settings = readFileSync(
    join(process.cwd(), 'src', 'app', 'settings', 'page.tsx'),
    'utf8',
  );
  assert.match(settings, /res\.status === 503 && data\.error === 'Verification service is not configured'/);
  assert.match(settings, /Your KYC has not been submitted/);
  assert.ok(settings.indexOf('if (!res.ok)') < settings.indexOf('setIsKycSubmitted(true)'));
});
