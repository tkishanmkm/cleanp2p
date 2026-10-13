import assert from 'node:assert/strict';
import { verifyWorkerAuth } from '../src/lib/security/worker-auth';

const secret = 'test-worker-secret';

function request(url: string, headers?: Record<string, string>): Request {
  return new Request(url, { headers });
}

function run() {
  // Query string must be rejected, even when legacy caller passes checkQueryParam=true.
  const queryOnly = verifyWorkerAuth(
    request('https://example.test/api/cron/indexer?key=test-worker-secret'),
    { allowedSecrets: [secret], checkQueryParam: true }
  );
  assert.equal(queryOnly.authorized, false, 'query-string credentials must not authorize');

  // Bearer and configured header credentials remain supported.
  assert.equal(
    verifyWorkerAuth(request('https://example.test/worker', { authorization: 'Bearer test-worker-secret' }), {
      allowedSecrets: [secret],
    }).authorized,
    true,
    'valid bearer token should authorize'
  );
  assert.equal(
    verifyWorkerAuth(request('https://example.test/worker', { 'x-service-key': secret }), {
      allowedSecrets: [secret],
    }).authorized,
    true,
    'valid service header should authorize'
  );

  // Empty server configuration fails closed.
  assert.equal(
    verifyWorkerAuth(request('https://example.test/worker', { 'x-service-key': secret }), {
      allowedSecrets: ['placeholder-key'],
    }).authorized,
    false,
    'placeholder-only configuration must fail closed'
  );

  // Invalid header credential remains rejected.
  assert.equal(
    verifyWorkerAuth(request('https://example.test/worker', { 'x-service-key': 'wrong' }), {
      allowedSecrets: [secret],
    }).authorized,
    false,
    'invalid header credential must be rejected'
  );

  console.log('worker-auth tests passed (5 assertions)');
}

run();
