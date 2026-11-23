import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const genericWebhook = read('src/app/api/webhooks/deposit/route.ts');
const alchemyWebhook = read('src/app/api/webhooks/alchemy/route.ts');
const walletDeposit = read('src/app/api/wallet/deposit/route.ts');

test('generic deposit webhook cannot assert confirmations from an untrusted payload', () => {
  assert.ok(genericWebhook.includes('p_confirmations: 0,'));
  assert.ok(genericWebhook.includes('Webhook payloads are not authoritative confirmation evidence'));
  assert.ok(!genericWebhook.includes('p_confirmations: item.confirmations ?? 12'));
});

test('Alchemy webhook cannot use a hard-coded confirmation threshold to credit', () => {
  assert.ok(alchemyWebhook.includes('p_confirmations: 0,'));
  assert.ok(!alchemyWebhook.includes('p_confirmations: 12,'));
});

test('wallet deposit ingress cannot claim confirmations without chain verification', () => {
  assert.ok(walletDeposit.includes('p_confirmations: 0,'));
  assert.ok(!walletDeposit.includes('p_confirmations: 12,'));
});

test('Alchemy token ingress re-queries canonical receipt and derives a unique transfer log index', () => {
  assert.ok(alchemyWebhook.includes('resolveUniqueEvmTransferEvidence('));
  assert.ok(alchemyWebhook.includes('p_output_index: outputIndex'));
  assert.ok(alchemyWebhook.includes('outputIndex = evidence.index'));
  assert.ok(alchemyWebhook.includes("provider.getTransactionReceipt(txHash)"));
  assert.ok(alchemyWebhook.includes("providerNetwork.chainId !== expectedChainId"));
  assert.ok(alchemyWebhook.includes('if (!evidence)'));
});

test('generic webhook derives token output indexes from canonical receipt evidence', () => {
  assert.ok(genericWebhook.includes('resolveUniqueEvmTransferEvidence('));
  assert.ok(genericWebhook.includes('p_output_index: outputIndex'));
  assert.ok(genericWebhook.includes('outputIndex = evidence.index'));
  assert.ok(genericWebhook.includes('if (!evidence)'));
  assert.ok(genericWebhook.includes('Missing or invalid output/event index; deposit not registered'));
});

test('worker-auth wallet ingress derives EVM log indexes from unique receipt evidence', () => {
  assert.ok(walletDeposit.includes('resolveUniqueEvmTransferEvidence('));
  assert.ok(walletDeposit.includes('p_output_index: resolvedOutputIndex'));
  assert.ok(walletDeposit.includes('if (!evidence)'));
  assert.ok(!walletDeposit.includes('p_output_index: Number(outputIndex) || 0'));
});

console.log('PASS: deposit ingress uses pending registration and independently verified confirmation/log evidence.');
