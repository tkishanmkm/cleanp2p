import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/kyc/initiate/route.ts', 'utf8');
const config = readFileSync('src/lib/didit-config.ts', 'utf8');

test('Didit configuration precedes compliance storage and external provider calls', () => {
  const guard = source.indexOf('if (!diditConfig)');
  const b2Write = source.indexOf('const b2Res = await saveKycAddressToB2');
  const providerRequest = source.indexOf('res = await fetch(targetUrl');
  assert.ok(guard >= 0 && b2Write > guard && providerRequest > b2Write);
});

test('workflow comes from deployment config, never a hard-coded fallback', () => {
  assert.ok(config.includes('process.env.DIDIT_WORKFLOW_ID?.trim()'));
  assert.ok(!source.includes('DIDIT_WORKFLOW_ID ||'));
  assert.ok(source.includes('workflow_id: workflowId'));
});

test('KYC initiation probes and registers sessions through the secure actor-bound RPC', () => {
  const probe = source.indexOf("supabase.rpc('initiate_didit_kyc_secure'");
  const validation = source.indexOf('typeof sessionId');
  const registration = source.lastIndexOf("supabase.rpc('initiate_didit_kyc_secure'");
  assert.ok(probe >= 0 && validation > probe && registration > validation);
  assert.ok(source.includes('p_actor_id: null'));
  assert.ok(source.includes('p_actor_id: user.id'));
  assert.ok(source.includes('SECURE_KYC_INITIATION_RPC_NOT_INSTALLED'));
  assert.ok(source.includes("parsedSessionUrl.protocol !== 'https:'"));
  assert.ok(source.includes('trustedDiditHost'));
  assert.ok(source.includes('AbortSignal.timeout(15_000)'));
  assert.ok(source.includes('initiationResult.success !== true'));
});

test('settings UI never reports submission when KYC response failed', () => {
  const settings = readFileSync('src/app/settings/page.tsx', 'utf8');
  assert.ok(settings.includes('Your KYC has not been submitted'));
  assert.ok(settings.indexOf('if (!res.ok)') < settings.indexOf('setIsKycSubmitted(true)'));
});
