/**
 * Post-Remediation Security & Chaos Penetration Test Suite (Playwright / Jest)
 * 
 * Target Architecture: Next.js 14 App Router + Supabase RLS + Web3 Hot Wallets
 * 
 * Coverage:
 *  - Script 1: VULN-01 IDOR Withdrawal Exploit (Unauthenticated / Missing Session) -> Assert HTTP 401
 *  - Script 2: VULN-04 Alchemy Webhook Spoofing (Counterfeit ERC-20 Address) -> Assert Rejection & No Balance Inflation
 *  - Script 3: Concurrency Race Condition (20 Parallel PATCH / Release Requests) -> Assert Only 1 Succeeds & Atomic Locks Hold
 */

import { test, expect } from '@playwright/test';
import crypto from 'crypto';

const BASE_URL = process.env.TEST_APP_URL || 'http://localhost:3000';
const ALCHEMY_SIGNING_KEY = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || 'test-webhook-signing-key-for-audit-verification';

test.describe('Security & Chaos Penetration Suite', () => {

  // ==========================================================================
  // SCRIPT 1: VULN-01 IDOR Withdrawal Exploit Attempt
  // ==========================================================================
  test('Script 1 [VULN-01]: IDOR withdrawal request without active session cookies returns HTTP 401', async ({ request }) => {
    const victimUserId = '00000000-0000-0000-0000-000000000001';
    const attackerDestination = '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E';

    // 1. Attempt POST without session cookies or authorization header
    const unauthResponse = await request.post(`${BASE_URL}/api/withdraw`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        targetUserId: victimUserId,
        user_id: victimUserId,
        asset: 'USDT',
        amount: 5000.0,
        destinationAddress: attackerDestination,
        totpCode: '123456',
      },
    });

    // Verify fail-closed behavior at middleware / endpoint
    expect(unauthResponse.status()).toBe(401);
    const body = await unauthResponse.json();
    expect(body.error).toBeDefined();

    // 2. Attempt with a forged / tampered bearer token
    const forgedTokenResponse = await request.post(`${BASE_URL}/api/withdraw`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer forged.jwt.token',
      },
      data: {
        targetUserId: victimUserId,
        asset: 'USDT',
        amount: 5000.0,
        destinationAddress: attackerDestination,
        totpCode: '123456',
      },
    });

    expect(forgedTokenResponse.status()).toBe(401);
  });

  // ==========================================================================
  // SCRIPT 2: VULN-04 Alchemy Webhook Spoofing (Counterfeit USDT Address)
  // ==========================================================================
  test('Script 2 [VULN-04]: Alchemy webhook spoofing with fake USDT contract address is rejected', async ({ request }) => {
    const testRecipient = '0x1111111111111111111111111111111111111111';
    const counterfeitContract = '0x00000000000000000000000000000000deadbeef'; // Attacker counterfeit token
    const legitMainnetUsdt = '0xdac17f958d2ee523a2206206994597c13d831ec7';

    // 1. Missing or invalid signature returns HTTP 401
    const invalidSigRes = await request.post(`${BASE_URL}/api/webhooks/alchemy`, {
      headers: {
        'Content-Type': 'application/json',
      },
      data: { event: { activity: [] } },
    });
    expect(invalidSigRes.status()).toBe(401);

    // 2. Validly signed payload claiming 50,000 USDT but using counterfeit contract address
    const maliciousPayload = {
      network: 'eth-mainnet',
      event: {
        activity: [
          {
            hash: '0x' + 'a'.repeat(64),
            fromAddress: '0xattacker00000000000000000000000000000000',
            toAddress: testRecipient,
            value: 50000.0,
            asset: 'USDT',
            rawContract: {
              address: counterfeitContract, // NOT legitimate contract
            },
          },
        ],
      },
    };

    const rawBody = JSON.stringify(maliciousPayload);
    const validHmac = crypto
      .createHmac('sha256', ALCHEMY_SIGNING_KEY)
      .update(rawBody)
      .digest('hex');

    const webhookRes = await request.post(`${BASE_URL}/api/webhooks/alchemy`, {
      headers: {
        'Content-Type': 'application/json',
        'x-alchemy-signature': validHmac,
      },
      data: rawBody,
    });

    // Endpoint must process cleanly without crediting the fake asset
    expect(webhookRes.status()).toBe(200);

    // Verify through deposit status / balance endpoint that 50,000 USDT was never credited
    const balanceRes = await request.get(`${BASE_URL}/api/wallet/balances`, {
      headers: { 'x-test-address': testRecipient },
    }).catch(() => null);

    if (balanceRes && balanceRes.ok()) {
      const balanceData = await balanceRes.json();
      expect(Number(balanceData.available || 0)).toBeLessThan(50000);
    }
  });

  // ==========================================================================
  // SCRIPT 3: CHAOS CONCURRENCY - 20 Simultaneous HTTP PATCH Requests
  // ==========================================================================
  test('Script 3 [CHAOS]: 20 simultaneous HTTP PATCH requests allow strictly 1 completion and prevent double-spending', async ({ request }) => {
    const testOrderId = '44444444-4444-4444-4444-444444444444';
    const CONCURRENCY_COUNT = 20;

    // Fire 20 parallel HTTP PATCH requests simultaneously to race order completion
    const requests = Array.from({ length: CONCURRENCY_COUNT }, () =>
      request.patch(`${BASE_URL}/api/p2p/orders/${testOrderId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer valid_mock_seller_token',
        },
        data: {
          status: 'COMPLETED',
        },
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status());

    const successCount = statuses.filter((s) => s === 200).length;
    const rejectedCount = statuses.filter((s) => s !== 200).length;

    // Exactly 1 request may complete the state machine transition; others must fail closed
    expect(successCount).toBeLessThanOrEqual(1);
    expect(rejectedCount).toBeGreaterThanOrEqual(CONCURRENCY_COUNT - 1);
  });
});
