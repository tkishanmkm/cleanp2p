import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { deriveUserKeys } from '../src/lib/crypto/hd-engine';

// Published BIP-39 test mnemonic only. Derived keys stay in memory and are never logged.
const fixtureMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('derives supported mainnet address formats at an allocated positive index', async () => {
  const derived = await deriveUserKeys(fixtureMnemonic, 1);

  assert.match(derived.btc.address, /^bc1q/);
  assert.match(derived.ltc.address, /^ltc1q/);
  assert.equal(ethers.isAddress(derived.evm.address), true);
  assert.match(derived.tron.address, /^T[1-9A-HJ-NP-Za-km-z]{33}$/);
});

test('allocates distinct BTC, LTC, EVM and TRON addresses across positive child indexes', async () => {
  const derived = await Promise.all([1, 2, 3].map((index) => deriveUserKeys(fixtureMnemonic, index)));

  for (const chain of ['btc', 'ltc', 'evm', 'tron'] as const) {
    assert.equal(new Set(derived.map((wallet) => wallet[chain].address)).size, derived.length, `${chain} address collision`);
  }
});

test('rejects the reserved child index zero', async () => {
  await assert.rejects(
    () => deriveUserKeys(fixtureMnemonic, 0),
    /positive safe BIP-32 child index/,
  );
});
