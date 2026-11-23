import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDiditServerConfig } from '../src/lib/didit-config';

const keys = ['DIDIT_API_KEY', 'DIDIT_WORKFLOW_ID', 'DIDIT_API_URL', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_APP_URL'] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
function restoreEnv() {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
}
function setValidEnv() {
  process.env.DIDIT_API_KEY = 'test-key-not-a-real-secret';
  process.env.DIDIT_WORKFLOW_ID = 'workflow-from-current-account';
  process.env.DIDIT_API_URL = 'https://verification.didit.me/v3';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://wayones.example';
  delete process.env.NEXT_PUBLIC_APP_URL;
}

test('Didit config uses deployment credentials and trusted callback origin', () => {
  setValidEnv();
  try {
    assert.deepEqual(getDiditServerConfig(), {
      apiKey: 'test-key-not-a-real-secret',
      workflowId: 'workflow-from-current-account',
      sessionUrl: 'https://verification.didit.me/v3/session/',
      callbackUrl: 'https://wayones.example/dashboard/kyc/callback',
    });
  } finally { restoreEnv(); }
});

test('missing Didit credentials/workflow/public origin fails closed', () => {
  setValidEnv();
  try {
    delete process.env.DIDIT_API_KEY;
    assert.equal(getDiditServerConfig(), null);
    setValidEnv();
    delete process.env.DIDIT_WORKFLOW_ID;
    assert.equal(getDiditServerConfig(), null);
    setValidEnv();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal(getDiditServerConfig(), null);
  } finally { restoreEnv(); }
});

test('Didit endpoint rejects untrusted hosts, HTTP, custom ports, credentials and non-v3 paths', () => {
  setValidEnv();
  try {
    for (const badUrl of [
      'http://verification.didit.me/v3',
      'https://attacker.example/v3',
      'https://verification.didit.me:8443/v3',
      'https://user:pass@verification.didit.me/v3',
      'https://verification.didit.me/v2',
      'https://verification.didit.me/v3?redirect=https://attacker.example',
    ]) {
      process.env.DIDIT_API_URL = badUrl;
      assert.equal(getDiditServerConfig(), null, badUrl);
    }
  } finally { restoreEnv(); }
});

test('legacy session routes delegate to one canonical Didit initiation handler', () => {
  const canonical = readFileSync('src/app/api/kyc/initiate/route.ts', 'utf8');
  assert.ok(canonical.includes('getDiditServerConfig()'));
  assert.ok(canonical.includes('workflow_id: workflowId'));
  assert.ok(!canonical.includes('DIDIT_WORKFLOW_ID ||'));
  for (const path of ['src/app/api/didit/verify/route.ts', 'src/app/api/verify/route.ts']) {
    const alias = readFileSync(path, 'utf8');
    assert.ok(alias.includes('POST as initiateKyc'));
    assert.ok(alias.includes('return initiateKyc(req)'));
    assert.ok(!alias.includes('workflow_id'));
  }
});

test('KYC config is validated before compliance storage or provider session creation', () => {
  const source = readFileSync('src/app/api/kyc/initiate/route.ts', 'utf8');
  const guard = source.indexOf('if (!diditConfig)');
  const b2Write = source.indexOf('const b2Res = await saveKycAddressToB2');
  const request = source.indexOf('res = await fetch(targetUrl');
  assert.ok(guard >= 0 && b2Write > guard && request > b2Write);
});

test('Didit deployment variable names are documented without embedded secrets', () => {
  const env = readFileSync('.env.example', 'utf8');
  for (const key of ['DIDIT_API_KEY=', 'DIDIT_WORKFLOW_ID=', 'DIDIT_API_URL=', 'DIDIT_WEBHOOK_SECRET=', 'NEXT_PUBLIC_SITE_URL=']) {
    assert.ok(env.includes(key));
  }
  assert.doesNotMatch(env, /DIDIT_API_KEY=.{8,}/);
  assert.doesNotMatch(env, /DIDIT_WORKFLOW_ID=.{8,}/);
});
