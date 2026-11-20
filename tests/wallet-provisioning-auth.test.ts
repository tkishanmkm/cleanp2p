import assert from 'node:assert/strict';
import { isWalletProvisioningServiceBearer } from '../src/lib/wallet/provisioning-auth';

const secret = 'unit-test-wallet-provisioning-secret-32-bytes-minimum';

assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret}`, secret), true);
assert.equal(isWalletProvisioningServiceBearer(`bearer ${secret}`, secret), true);
assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret}x`, secret), false);
assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret}`, `${secret}x`), false);
assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret}`, 'short'), false);
assert.equal(isWalletProvisioningServiceBearer(null, secret), false);
assert.equal(isWalletProvisioningServiceBearer(`Basic ${secret}`, secret), false);
assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret} extra`, secret), false);
assert.equal(isWalletProvisioningServiceBearer(`Bearer ${secret}`, undefined), false);

console.log('PASS: wallet provisioning service bearer contract checks');
