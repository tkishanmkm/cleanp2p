import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const genericWebhook = readFileSync('src/app/api/webhooks/deposit/route.ts', 'utf8');
const alchemyWebhook = readFileSync('src/app/api/webhooks/alchemy/route.ts', 'utf8');
const walletDeposit = readFileSync('src/app/api/wallet/deposit/route.ts', 'utf8');

test('generic deposit webhook cannot assert confirmations from payload', () => {
  assert.match(genericWebhook, /p_confirmations:\s*0,/);
  assert.doesNotMatch(genericWebhook, /p_confirmations:\s*item\.confirmations\s*\?\?\s*12/);
});

test('Alchemy webhook cannot use a hard-coded confirmation threshold to credit', () => {
  assert.match(alchemyWebhook, /p_confirmations:\s*0,/);
  assert.doesNotMatch(alchemyWebhook, /p_confirmations:\s*12,/);
});

test('wallet deposit ingress cannot claim confirmations without chain verification', () => {
  assert.match(walletDeposit, /p_confirmations:\s*0,/);
  assert.doesNotMatch(walletDeposit, /p_confirmations:\s*12,/);
});

test('Alchemy token ingress derives the actual transfer log index and fails closed on ambiguity', () => {
  assert.match(alchemyWebhook, /resolveEvmTransferLogIndex\(/);
  assert.match(alchemyWebhook, /p_output_index:\s*outputIndex/);
  assert.match(alchemyWebhook, /resolvedIndex === null/);
  assert.doesNotMatch(alchemyWebhook, /p_output_index:\s*0,/);
  assert.doesNotMatch(alchemyWebhook, /process_deposit_atomic/);
});


test('generic webhook derives EVM token indexes from receipt evidence and rejects missing non-EVM indexes', () => {
  assert.match(genericWebhook, /resolveEvmTransferLogIndex\(/);
  assert.match(genericWebhook, /p_output_index:\s*outputIndex/);
  assert.match(genericWebhook, /Missing or invalid output\/event index/);
  assert.doesNotMatch(genericWebhook, /logIndex:\s*0,/);
});

test('worker-auth wallet ingress does not trust/default an EVM token log index', () => {
  assert.match(walletDeposit, /resolveEvmTransferLogIndex\(/);
  assert.match(walletDeposit, /p_output_index:\s*resolvedOutputIndex/);
  assert.doesNotMatch(walletDeposit, /p_output_index:\s*Number\(outputIndex\)\s*\|\|\s*0/);
});
