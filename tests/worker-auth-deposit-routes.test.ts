import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { timingSafeEqualString, verifyWorkerAuth } from '../src/lib/security/worker-auth';

const options = {
  allowedSecrets: ['test-worker-secret'],
  customHeaderNames: ['x-ingest-secret'],
  checkQueryParam: true,
};

function request(url = 'https://example.test/api/worker', headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

test('worker auth fails closed when no secret is configured', () => {
  const result = verifyWorkerAuth(request(), { allowedSecrets: [undefined, '', 'placeholder-key'] });
  assert.equal(result.authorized, false);
});

test('worker auth rejects missing and incorrect credentials', () => {
  assert.equal(verifyWorkerAuth(request(), options).authorized, false);
  assert.equal(verifyWorkerAuth(request(undefined, { 'x-ingest-secret': 'wrong-secret' }), options).authorized, false);
});

test('worker auth accepts bearer and configured custom header credentials', () => {
  assert.equal(verifyWorkerAuth(request(undefined, { authorization: 'Bearer test-worker-secret' }), options).authorized, true);
  assert.equal(verifyWorkerAuth(request(undefined, { 'x-ingest-secret': 'test-worker-secret' }), options).authorized, true);
});

test('worker auth only reads query credentials when explicitly enabled', () => {
  assert.equal(verifyWorkerAuth(request('https://example.test/api/worker?key=test-worker-secret'), options).authorized, true);
  assert.equal(verifyWorkerAuth(request('https://example.test/api/worker?key=test-worker-secret'), { ...options, checkQueryParam: false }).authorized, false);
});

test('timing-safe comparison handles unequal lengths without throwing', () => {
  assert.equal(timingSafeEqualString('x', 'longer'), false);
  assert.equal(timingSafeEqualString('same', 'same'), true);
  assert.equal(timingSafeEqualString('same', 'diff'), false);
});

test('balance-crediting webhook routes fail closed on missing authentication configuration', () => {
  const alchemy = readFileSync('src/app/api/webhooks/alchemy/route.ts', 'utf8');
  const walletDeposit = readFileSync('src/app/api/wallet/deposit/route.ts', 'utf8');
  const genericWebhook = readFileSync('src/app/api/webhooks/deposit/route.ts', 'utf8');
  const chainIngest = readFileSync('src/app/api/internal/chain-ingest/route.ts', 'utf8');

  assert.match(alchemy, /if \(!SYSTEM_CONFIG\.secrets\.webhook\)/);
  assert.match(alchemy, /if \(!signature \|\| !verifySignature\(/);
  assert.match(walletDeposit, /verifyWorkerAuth\(/);
  assert.match(walletDeposit, /if \(!auth\.authorized\)/);
  assert.match(genericWebhook, /timingSafeEqualString\(ingestHeader, secret\)/);
  assert.match(chainIngest, /timingSafeEqualString\(providedSecret, configuredSecret\)/);
});
