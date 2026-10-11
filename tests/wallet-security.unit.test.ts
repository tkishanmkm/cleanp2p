import assert from 'node:assert/strict';
import { verifyWorkerAuth } from '../src/lib/security/worker-auth';
import { getSupabaseAdminClient } from '../src/lib/supabase/server';
import { POST as disabledDepositPost } from '../src/app/api/wallet/deposit/route';

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

  console.log('Wallet security unit checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
