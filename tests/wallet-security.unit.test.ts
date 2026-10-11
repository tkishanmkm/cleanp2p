import assert from 'node:assert/strict';
import { verifyWorkerAuth } from '../src/lib/security/worker-auth';
import {
  normalizeNetwork,
  validateDestinationAddress,
  SUPPORTED_ASSETS,
} from '../src/lib/services/withdrawalService';
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

  assert.equal(normalizeNetwork('TRON'), 'TRC20');
  assert.equal(normalizeNetwork('BSC'), 'BEP20');
  assert.equal(normalizeNetwork('BITCOIN'), 'BTC');

  const validEvm = '0x000000000000000000000000000000000000dead';
  assert.equal(validateDestinationAddress(validEvm, 'ERC20').valid, true);
  assert.equal(validateDestinationAddress('not-an-address', 'ERC20').valid, false);
  assert.deepEqual([...SUPPORTED_ASSETS], ['USDT']);

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
