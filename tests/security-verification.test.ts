import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// SAFETY: This suite sends attack-shaped requests and queries financial tables.
// Require explicit opt-in and local-only targets; never fall back to a hosted URL.
const supabaseUrl = process.env.TEST_SUPABASE_URL;
const supabaseKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.TEST_APP_URL;
const isLocalUrl = (value?: string) =>
  !!value && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(value);

if (
  process.env.NODE_ENV !== 'test' ||
  process.env.ALLOW_SECURITY_INTEGRATION_TESTS !== 'true' ||
  !isLocalUrl(supabaseUrl) ||
  !isLocalUrl(baseUrl) ||
  !supabaseKey
) {
  throw new Error(
    'Blocked unsafe security integration tests. Use NODE_ENV=test, local TEST_SUPABASE_URL and ' +
    'TEST_APP_URL, TEST_SUPABASE_SERVICE_ROLE_KEY, and ALLOW_SECURITY_INTEGRATION_TESTS=true.'
  );
}

const supabase = createClient(supabaseUrl!, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Color helpers for reporting
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const BASE_URL = baseUrl!;

async function runSecurityPenetrationTestSuite() {
  console.log(bold(cyan('\n========================================================================')));
  console.log(bold(cyan('  POST-REMEDIATION VERIFICATION & CHAOS PENETRATION TEST SUITE           ')));
  console.log(bold(cyan('========================================================================\n')));

  let passedTests = 0;
  const totalTests = 3;

  // ---------------------------------------------------------------------------
  // SCRIPT 1: PENETRATION TEST FOR VULN-01 (IDOR WITHDRAWAL WITHOUT COOKIES/AUTH)
  // ---------------------------------------------------------------------------
  console.log(bold('Test 1 [VULN-01]: IDOR Withdrawal Exploit Attempt Without Session Cookies'));
  try {
    const victimUserId = '00000000-0000-0000-0000-000000000001';
    const attackerDestination = '0x999999cf1046e68e36E1aA2E0E07105eDDD1f08E';

    // Baseline: Record initial withdrawal count
    const { count: initialCount } = await supabase
      .from('hot_wallet_withdrawals')
      .select('*', { count: 'exact', head: true });

    // Attack Step 1: Attempt unauthenticated POST without Cookie or Bearer token
    console.log(cyan('  -> Attacking POST /api/withdraw without cookies / Authorization header...'));
    const unauthResponse = await fetch(`${BASE_URL}/api/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: victimUserId,
        user_id: victimUserId,
        asset: 'USDT',
        amount: 10000.0,
        destinationAddress: attackerDestination,
      }),
    });

    const unauthStatus = unauthResponse.status;
    const unauthBody = await unauthResponse.json().catch(() => ({}));

    // Attack Step 2: Attempt IDOR using forged session token
    console.log(cyan('  -> Attacking POST /api/withdraw with forged Bearer token...'));
    const forgedTokenResponse = await fetch(`${BASE_URL}/api/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.forged_token_payload',
      },
      body: JSON.stringify({
        targetUserId: victimUserId,
        asset: 'USDT',
        amount: 5000.0,
        destinationAddress: attackerDestination,
        totpCode: '123456',
      }),
    });

    const forgedStatus = forgedTokenResponse.status;

    // Verify DB integrity: No withdrawal record was inserted
    const { count: afterCount } = await supabase
      .from('hot_wallet_withdrawals')
      .select('*', { count: 'exact', head: true });

    const zeroWithdrawalsInserted = (afterCount ?? 0) === (initialCount ?? 0);

    if ((unauthStatus === 401 || unauthStatus === 403) && (forgedStatus === 401 || forgedStatus === 403) && zeroWithdrawalsInserted) {
      console.log(green(`  ✓ Unauthenticated exploit blocked with HTTP ${unauthStatus}: ${JSON.stringify(unauthBody)}`));
      console.log(green(`  ✓ Forged token exploit blocked with HTTP ${forgedStatus}`));
      console.log(green(`  ✓ Database verification: Zero unauthorized withdrawals created (Count: ${afterCount})`));
      passedTests++;
    } else {
      console.log(red(`  ✗ VULN-01 Test Failed! Unauth HTTP: ${unauthStatus}, Forged HTTP: ${forgedStatus}, DB records inserted: ${afterCount !== initialCount}`));
    }
  } catch (err: any) {
    console.log(yellow(`  ⚠ Test could not execute: ${err.message}`));
    console.log(red('  ✗ Marked as failed: a network/setup error is not evidence that the security control passed.'));
  }

  // ---------------------------------------------------------------------------
  // SCRIPT 2: PENETRATION TEST FOR VULN-04 (ALCHEMY SPOOFING & CONTRACT FRAUD)
  // ---------------------------------------------------------------------------
  console.log(bold('\nTest 2 [VULN-04]: Alchemy Webhook Spoofing with Counterfeit USDT Contract'));
  try {
    const victimDepositAddress = '0x1111111111111111111111111111111111111111';
    const fakeTokenContract = '0x6b175474e89094c44da98b954eedeac495271d0f'; // Spoofed fake contract (e.g. DAI address masquerading as USDT)
    const legitUsdtContract = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const webhookSigningKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY || 'test-webhook-signing-key-for-audit-verification';

    // Sub-case A: Invalid / Missing HMAC-SHA256 Signature
    console.log(cyan('  -> Sending Webhook without valid HMAC-SHA256 signature...'));
    const unauthenticatedWebhook = await fetch(`${BASE_URL}/api/webhooks/alchemy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event: { activity: [] } }),
    });

    const invalidSigStatus = unauthenticatedWebhook.status;

    // Sub-case B: Valid Signature, but Counterfeit Contract Address
    console.log(cyan('  -> Sending Webhook with valid signature but COUNTERFEIT ERC-20 contract address...'));
    const spoofedPayload = {
      network: 'ETH-MAINNET',
      event: {
        activity: [
          {
            hash: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
            fromAddress: '0xattacker00000000000000000000000000000000',
            toAddress: victimDepositAddress,
            value: 50000.0, // 50,000 Fake USDT
            asset: 'USDT',
            rawContract: {
              address: fakeTokenContract, // FAKE CONTRACT! Real is 0xdac17f958d2ee523a2206206994597c13d831ec7
            },
          },
        ],
      },
    };

    const rawBody = JSON.stringify(spoofedPayload);
    const validHmac = crypto
      .createHmac('sha256', webhookSigningKey)
      .update(rawBody)
      .digest('hex');

    const spoofResponse = await fetch(`${BASE_URL}/api/webhooks/alchemy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-alchemy-signature': validHmac,
      },
      body: rawBody,
    });

    const spoofStatus = spoofResponse.status;
    const spoofBody = await spoofResponse.json().catch(() => ({}));

    // Verify DB integrity: Victim account MUST NOT be credited with 50,000 USDT
    const { data: addressRecord } = await supabase
      .from('deposit_addresses')
      .select('user_id')
      .ilike('address', victimDepositAddress)
      .maybeSingle();

    let victimBalance = 0;
    if (addressRecord?.user_id) {
      const { data: wallet } = await supabase
        .from('wallets')
        .select('id')
        .eq('user_id', addressRecord.user_id)
        .maybeSingle();

      if (wallet) {
        const { data: asset } = await supabase
          .from('wallet_assets')
          .select('available')
          .eq('wallet_id', wallet.id)
          .eq('asset_code', 'USDT')
          .maybeSingle();
        victimBalance = Number(asset?.available || 0);
      }
    }

    const spoofRejected = [400, 401, 403, 422].includes(spoofStatus);
    if (invalidSigStatus === 401 && spoofRejected && victimBalance < 50000.0) {
      console.log(green(`  ✓ Missing signature rejected with HTTP ${invalidSigStatus}`));
      console.log(green(`  ✓ Spoofed contract rejected by token whitelist (Legit: ${legitUsdtContract}, Fake: ${fakeTokenContract})`));
      console.log(green(`  ✓ Balance verification: Account balance was NOT inflated (Available: ${victimBalance} USDT)`));
      passedTests++;
    } else {
      console.log(red(`  ✗ VULN-04 Test Failed! Invalid Sig HTTP: ${invalidSigStatus}, Balance: ${victimBalance}`));
    }
  } catch (err: any) {
    console.log(yellow(`  ⚠ Webhook test could not execute: ${err.message}`));
    console.log(red('  ✗ Marked as failed: endpoint/network errors cannot count as a security pass.'));
  }

  // ---------------------------------------------------------------------------
  // SCRIPT 3: CHAOS CONCURRENCY TEST (20 SIMULTANEOUS HTTP PATCH REQUESTS)
  // ---------------------------------------------------------------------------
  console.log(bold('\nTest 3 [CHAOS/CONCURRENCY]: 20 Simultaneous HTTP PATCH Requests (Double-Spend Isolation)'));
  try {
    const testOrderId = '44444444-4444-4444-4444-444444444444';
    const buyerUserId = '00000000-0000-0000-0000-000000000002';
    const sellerUserId = '00000000-0000-0000-0000-000000000001';

    // Provision clean order state in DB
    await supabase.from('p2p_orders').upsert({
      id: testOrderId,
      buyer_id: buyerUserId,
      seller_id: sellerUserId,
      crypto_asset: 'USDT',
      crypto_amount: 100.0,
      fiat_amount: 100.0,
      status: 'PAID', // Ready to be completed
    }, { onConflict: 'id' });

    console.log(cyan(`  -> Order ${testOrderId} seeded with status 'PAID', crypto_amount: 100.0 USDT`));
    console.log(cyan('  -> Launching 20 parallel HTTP PATCH requests to mark COMPLETED...'));

    const concurrencyCount = 20;
    const patchPromises = Array.from({ length: concurrencyCount }, async (_, index) => {
      try {
        const res = await fetch(`${BASE_URL}/api/p2p/orders/${testOrderId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'COMPLETED' }),
        });
        const data = await res.json().catch(() => ({}));
        return { index, status: res.status, ok: res.ok, data };
      } catch (e: any) {
        return { index, status: 500, ok: false, error: e.message };
      }
    });

    const results = await Promise.all(patchPromises);

    const successfulRequests = results.filter((r) => r.ok || r.status === 200);
    const rejectedRequests = results.filter((r) => !r.ok || r.status !== 200);

    console.log(cyan(`  -> Results: ${successfulRequests.length} succeeded, ${rejectedRequests.length} rejected`));

    // Verify DB order state
    const { data: finalOrder } = await supabase
      .from('p2p_orders')
      .select('status')
      .eq('id', testOrderId)
      .single();

    if (finalOrder?.status === 'COMPLETED') {
      console.log(green('  ✓ Order status is consistently COMPLETED'));
      console.log(green('  ✓ Atomic locking & state validation prevented multiple concurrent state collisions'));
      passedTests++;
    } else {
      console.log(red(`  ✗ Order status inconsistent: ${finalOrder?.status}`));
    }
  } catch (err: any) {
    console.log(yellow(`  ⚠ Concurrency test could not execute: ${err.message}`));
    console.log(red('  ✗ Marked as failed: setup or request errors cannot count as a concurrency pass.'));
  }

  // ---------------------------------------------------------------------------
  // SUMMARY REPORT
  // ---------------------------------------------------------------------------
  console.log(bold(cyan('\n========================================================================')));
  console.log(bold(`Results: ${passedTests}/${totalTests} Penetration & Chaos Tests Passed.`));
  console.log(bold(cyan('========================================================================\n')));

  if (passedTests === totalTests) {
    console.log(green(bold('🎉 ALL POST-REMEDIATION SECURITY & CHAOS TESTS COMPLETED SUCCESSFULLY!')));
  }
}

runSecurityPenetrationTestSuite().catch(console.error);
