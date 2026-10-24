import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyHmacSha256, verifySharedWebhookSecret } from '../src/lib/webhooks/auth';

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/webhook', { method: 'POST', headers });
}

function run() {
  // Shared-secret authentication fails closed if configuration is absent/blank.
  assert.equal(verifySharedWebhookSecret(request({ 'x-webhook-secret': 'secret' }), undefined), false);
  assert.equal(verifySharedWebhookSecret(request({ 'x-webhook-secret': 'secret' }), ''), false);
  assert.equal(verifySharedWebhookSecret(request({ 'x-webhook-secret': 'secret' }), '   '), false);

  // Missing, wrong, and unequal-length credentials are rejected without throwing.
  assert.equal(verifySharedWebhookSecret(request(), 'secret'), false);
  assert.equal(verifySharedWebhookSecret(request({ 'x-webhook-secret': 'x' }), 'secret'), false);
  assert.equal(verifySharedWebhookSecret(request({ authorization: 'Bearer wrong' }), 'secret'), false);
  assert.equal(verifySharedWebhookSecret(request({ 'x-webhook-secret': 'secret' }), 'secret'), true);
  assert.equal(verifySharedWebhookSecret(request({ authorization: 'Bearer secret' }), 'secret'), true);

  const body = '{"event":"test"}';
  const secret = 'unit-test-secret';
  const signature = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(verifyHmacSha256(body, signature, secret), true);
  assert.equal(verifyHmacSha256(body, `sha256=${signature}`, secret), true);
  assert.equal(verifyHmacSha256(body + ' ', signature, secret), false);
  assert.equal(verifyHmacSha256(body, 'not-a-signature', secret), false);
  assert.equal(verifyHmacSha256(body, signature, undefined), false);
  assert.equal(verifyHmacSha256(body, null, secret), false);

  console.log('Webhook authentication unit tests passed.');
}

run();
