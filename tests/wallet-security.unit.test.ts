import assert from 'node:assert/strict';
import { verifyWorkerAuth } from '../src/lib/security/worker-auth';
import { getSupabaseAdminClient } from '../src/lib/supabase/server';
import { POST as disabledDepositPost } from '../src/app/api/wallet/deposit/route';
import { GET as legacyDepositGet } from '../src/app/api/wallets/deposit-address/route';
import { GET as legacyProvisionGet } from '../src/app/api/wallets/provision-address/route';
import { GET as legacyDispatchGet } from '../src/app/api/withdrawals/dispatch/route';
import { NextRequest } from 'next/server';

async function main() {
  const noSecretRequest = new Request('https://example.test/api/workers/withdrawal-worker');
  assert.equal(
    verifyWorkerAuth(noSecretRequest, { allowedSecrets: [] }).authorized,
    false,
    'worker auth must fail closed when no secret is configured'
  );

  const validWorkerRequest = new Request('https://example.test/api/workers/withdrawal-worker', {
    headers: { authorization: 'Bearer test-worker-secret' },
  });
  assert.equal(
    verifyWorkerAuth(validWorkerRequest, { allowedSecrets: ['test-worker-secret'] }).authorized,
    true,
    'configured worker secret should authorize a matching bearer token'
  );

  const invalidWorkerRequest = new Request('https://example.test/api/workers/withdrawal-worker', {
    headers: { authorization: 'Bearer wrong-secret' },
  });
  assert.equal(
    verifyWorkerAuth(invalidWorkerRequest, { allowedSecrets: ['test-worker-secret'] }).authorized,
    false,
    'incorrect worker secret must be rejected'
  );

  const previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(
      () => getSupabaseAdminClient(),
      /SUPABASE_SERVICE_ROLE_KEY is required/,
      'privileged Supabase client must fail closed without a service-role key'
    );
  } finally {
    if (previousServiceRoleKey === undefined) {
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    } else {
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
    }
  }

  const disabledDepositResponse = await disabledDepositPost();
  assert.equal(disabledDepositResponse.status, 503);
  const disabledDepositBody = await disabledDepositResponse.json();
  assert.equal(disabledDepositBody.code, 'DIRECT_DEPOSIT_CREDIT_DISABLED');

  const noSessionRequest = new NextRequest('https://example.test/api/wallets/deposit-address?userId=another-user');
  const legacyDepositResponse = await legacyDepositGet(noSessionRequest);
  assert.equal(legacyDepositResponse.status, 401, 'legacy deposit address route must reject unauthenticated requests');

  const legacyProvisionResponse = await legacyProvisionGet(
    new NextRequest('https://example.test/api/wallets/provision-address?userId=another-user')
  );
  assert.equal(legacyProvisionResponse.status, 401, 'legacy provisioning route must reject unauthenticated requests');

  const legacyDispatchResponse = await legacyDispatchGet(
    new NextRequest('https://example.test/api/withdrawals/dispatch')
  );
  assert.equal(legacyDispatchResponse.status, 410, 'legacy direct payout route must never dispatch a withdrawal');

  console.log('Wallet security unit checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
