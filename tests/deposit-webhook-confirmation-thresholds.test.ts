import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const btcWebhook = readFileSync('src/app/api/webhooks/blockcypher/route.ts', 'utf8');
const ltcWebhook = readFileSync('src/app/api/webhooks/litecoin/route.ts', 'utf8');

test('BTC webhook registers verified output as pending and never invokes the credit RPC', () => {
  assert.match(btcWebhook, /if \(!verified\)/);
  assert.match(btcWebhook, /rpc\('register_pending_deposit'/);
  assert.match(btcWebhook, /p_confirmations:\s*0,/);
  assert.doesNotMatch(btcWebhook, /process_deposit_atomic/);
  assert.doesNotMatch(btcWebhook, /p_confirmations:\s*verified\.confirmations/);
});

test('LTC webhook registers verified output as pending and never invokes the credit RPC', () => {
  assert.match(ltcWebhook, /if \(!verified\)/);
  assert.match(ltcWebhook, /rpc\('register_pending_deposit'/);
  assert.match(ltcWebhook, /p_confirmations:\s*0,/);
  assert.doesNotMatch(ltcWebhook, /process_deposit_atomic/);
  assert.doesNotMatch(ltcWebhook, /p_confirmations:\s*verified\.confirmations/);
});
