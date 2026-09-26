import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { deriveAllAddresses } from '../src/lib/hd-derivation-engine';
import { POST } from '../src/app/api/auth/provision-wallets/route';

describe('Wallet Provisioning Security & Logic Unit Tests', () => {
  it('A. Deterministic derivation produces distinct non-zero address sets for different indices', async () => {
    const addresses316 = deriveAllAddresses(316);
    const addresses317 = deriveAllAddresses(317);

    assert.ok(addresses316.ETH.startsWith('0x'), 'EVM address must start with 0x');
    assert.ok(addresses316.BTC.startsWith('bc1q'), 'BTC address must start with bc1q');
    assert.ok(addresses316.LTC.startsWith('ltc1q'), 'LTC address must start with ltc1q');
    assert.ok(addresses316.USDT_TRC20.startsWith('T'), 'TRON address must start with T');

    // Strict uniqueness check across derivation indices
    assert.notEqual(addresses316.ETH, addresses317.ETH, 'Indices 316 and 317 must yield different EVM addresses');
    assert.notEqual(addresses316.BTC, addresses317.BTC, 'Indices 316 and 317 must yield different BTC addresses');
    assert.notEqual(addresses316.LTC, addresses317.LTC, 'Indices 316 and 317 must yield different LTC addresses');
    assert.notEqual(addresses316.USDT_TRC20, addresses317.USDT_TRC20, 'Indices 316 and 317 must yield different TRON addresses');
  });

  it('B. No index 0 fallback: index 316 does NOT match index 0 addresses', async () => {
    const addresses0 = deriveAllAddresses(0);
    const addresses316 = deriveAllAddresses(316);

    assert.notEqual(addresses316.ETH, addresses0.ETH, 'Production address must never equal fallback index 0');
    assert.notEqual(addresses316.BTC, addresses0.BTC, 'Production address must never equal fallback index 0');
    assert.notEqual(addresses316.LTC, addresses0.LTC, 'Production address must never equal fallback index 0');
    assert.notEqual(addresses316.USDT_TRC20, addresses0.USDT_TRC20, 'Production address must never equal fallback index 0');
  });

  it('C. Idempotency: Multiple derivations of same index yield identical addresses', () => {
    const run1 = deriveAllAddresses(316);
    const run2 = deriveAllAddresses(316);

    assert.deepEqual(run1, run2, 'Derivation must be 100% idempotent');
  });

  it('D. Security: Derivation output contains only public addresses (no private keys or mnemonic)', () => {
    const output = deriveAllAddresses(316);
    const keys = Object.keys(output);

    assert.ok(!keys.includes('privateKey'), 'Output must not contain privateKey');
    assert.ok(!keys.includes('mnemonic'), 'Output must not contain mnemonic');
    assert.ok(!keys.includes('seed'), 'Output must not contain seed');
    assert.ok(!keys.includes('secret'), 'Output must not contain secret');

    for (const val of Object.values(output)) {
      assert.equal(typeof val, 'string');
      assert.ok(!val.includes(' '), 'Addresses must not contain whitespace / seed phrases');
    }
  });

  it('E. Route Security: Unauthenticated request to /api/auth/provision-wallets is rejected with 401', async () => {
    const req = new NextRequest('http://localhost:3000/api/auth/provision-wallets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId: '00000000-0000-0000-0000-000000000001' }),
    });

    const res = await POST(req);
    assert.equal(res.status, 401, 'Unauthenticated request must return 401 Unauthorized');
    const data = await res.json();
    assert.ok(data.error.includes('Unauthorized'), 'Error message must specify unauthorized');
  });
});
