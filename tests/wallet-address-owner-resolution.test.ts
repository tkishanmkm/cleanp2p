import assert from 'node:assert/strict';
import {
  DepositAddressOwnershipConflictError,
  normalizeDepositAddressForLookup,
  resolveDepositAddressOwnerFromRows,
} from '../src/lib/wallet/deposit-address-owner';

const ownerA = '11111111-1111-4111-8111-111111111111';
const ownerB = '22222222-2222-4222-8222-222222222222';
const evmAddress = '0xAbCd000000000000000000000000000000001234';
const btcAddress = 'bc1qexampleaddress000000000000000000000000';

assert.deepEqual(normalizeDepositAddressForLookup(evmAddress), {
  value: evmAddress.toLowerCase(),
  caseInsensitive: true,
});
assert.equal(normalizeDepositAddressForLookup('alice@example.com'), null);
assert.equal(normalizeDepositAddressForLookup('0x1234'), null);
assert.equal(normalizeDepositAddressForLookup('x'.repeat(129)), null);

assert.equal(
  resolveDepositAddressOwnerFromRows(evmAddress, [
    { user_id: ownerA, address: evmAddress.toLowerCase() },
    { user_id: ownerA, address: evmAddress.toUpperCase().replace('0X', '0x') },
  ]),
  ownerA,
);

assert.equal(
  resolveDepositAddressOwnerFromRows(btcAddress, [
    { user_id: ownerA, address: btcAddress },
  ]),
  ownerA,
);

// Base58 and Bech32 addresses are case-sensitive; EVM is not.
assert.equal(
  resolveDepositAddressOwnerFromRows(btcAddress, [
    { user_id: ownerA, address: btcAddress.toUpperCase() },
  ]),
  null,
);

assert.equal(
  resolveDepositAddressOwnerFromRows(btcAddress, [
    { user_id: ownerA, address: 'TAddressOther0000000000000000000000000' },
  ]),
  null,
);

assert.throws(
  () => resolveDepositAddressOwnerFromRows(evmAddress, [
    { user_id: ownerA, address: evmAddress },
    { user_id: ownerB, address: evmAddress.toLowerCase() },
  ]),
  DepositAddressOwnershipConflictError,
);

console.log('PASS: 8 deposit-address ownership resolution checks');
