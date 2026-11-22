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

test('Didit session configuration uses the active account workflow and key from environment', () => {
  setValidEnv();
  try {
    const config = getDiditServerConfig();
    assert.deepEqual(config, {
      apiKey: 'test-key-not-a-real-secret',
      workflowId: 'workflow-from-current-account',
      sessionUrl: 'https://verification.didit.me/v3/session/',
      callbackUrl: 'https://wayones.example/dashboard/kyc/callback',
    });
  } finally { restoreEnv(); }
});

test('missing API key, workflow ID, or public callback origin fails closed', () => {
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

test('Didit API endpoint rejects non-provider hosts, HTTP, ports, credentials and non-v3 paths', () => {
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

test('all session creation routes use the shared config and contain no embedded workflow fallback', () => {
  const routes = [
    'src/app/api/kyc/initiate/route.ts',
    'src/app/api/didit/verify/route.ts',
    'src/app/api/verify/route.ts',
  ];
  for (const path of routes) {
    const source = readFileSync(path, 'utf8');
    assert.match(source, /getDiditServerConfig\(\)/, path);
    assert.match(source, /if \(!diditConfig\)[\s\S]{0,150}status: 503/, path);
    assert.match(source, /workflow_id: workflowId/, path);
    assert.doesNotMatch(source, /DIDIT_WORKFLOW_ID\s*\|\|/);
    assert.doesNotMatch(source, /b36ac1aa-29fc-4272-8939-c1d184d072fd|e2b3e066-d5f9-45b8-a11c-1139c27f9beb/);
    assert.doesNotMatch(source, /paxones\.com/);
  }
});

test('KYC initiate validates Didit configuration before storing KYC address or changing profile state', () => {
  const source = readFileSync('src/app/api/kyc/initiate/route.ts', 'utf8');
  const configGuard = source.indexOf('if (!diditConfig)');
  const b2Write = source.indexOf('saveKycAddressToB2(');
  const profileWrite = source.indexOf(".update({ is_verified: false");
  const kycStatusWrite = source.indexOf("kyc_status: 'in_review'");
  assert.ok(configGuard >= 0);
  assert.ok(b2Write > configGuard);
  assert.ok(profileWrite === -1 || profileWrite > configGuard);
  assert.ok(kycStatusWrite === -1 || kycStatusWrite > configGuard);
});

test('Didit environment names are documented without embedding account secrets', () => {
  const env = readFileSync('.env.example', 'utf8');
  for (const key of ['DIDIT_API_KEY=', 'DIDIT_WORKFLOW_ID=', 'DIDIT_API_URL=', 'DIDIT_WEBHOOK_SECRET=', 'NEXT_PUBLIC_SITE_URL=']) {
    assert.ok(env.includes(key), `Missing ${key}`);
  }
  assert.doesNotMatch(env, /DIDIT_API_KEY=.{8,}/);
  assert.doesNotMatch(env, /DIDIT_WORKFLOW_ID=.{8,}/);
});

console.log('PASS: Didit configuration is environment-bound, provider-host-allowlisted, and fails closed before KYC side effects.');