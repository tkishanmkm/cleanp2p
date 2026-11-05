import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bitcoinLikePayoutMatches, decimalToBaseUnits, hasRequiredConfirmations } from '../src/lib/blockchain/utxo-withdrawal-validation';

const txid = 'a'.repeat(64);
const tx = {
  txid,
  vout: [
    { scriptpubkey_address: 'bc1qrecipient', value: 125000000 },
    { scriptpubkey_address: 'bc1qother', value: 2500 },
  ],
};

test('matches exact UTXO txid, destination and total output amount', () => {
  assert.equal(bitcoinLikePayoutMatches(tx, txid, 'bc1qrecipient', '1.25'), true);
  assert.equal(bitcoinLikePayoutMatches(tx, txid.toUpperCase(), 'bc1qrecipient', '1.25'), true);
  assert.equal(bitcoinLikePayoutMatches(tx, txid, 'bc1qrecipient', '1.25000001'), false);
  assert.equal(bitcoinLikePayoutMatches(tx, txid, 'bc1qmissing', '1.25'), false);
});
test('rejects malformed txids and invalid or over-precision amounts', () => {
  assert.equal(bitcoinLikePayoutMatches(tx, 'bad-hash', 'bc1qrecipient', '1.25'), false);
  assert.equal(bitcoinLikePayoutMatches({ ...tx, txid: 'bad-hash' }, txid, 'bc1qrecipient', '1.25'), false);
  assert.equal(bitcoinLikePayoutMatches(tx, txid, 'bc1qrecipient', '1.250000001'), false);
  assert.equal(bitcoinLikePayoutMatches(tx, txid, 'bc1qrecipient', '0'), false);
  assert.equal(decimalToBaseUnits('1e-8', 8), null);
});
test('requires a confirmed block and configured positive confirmation depth', () => {
  assert.equal(hasRequiredConfirmations(100, 102, 3), true);
  assert.equal(hasRequiredConfirmations(100, 101, 3), false);
  assert.equal(hasRequiredConfirmations(0, 102, 3), false);
  assert.equal(hasRequiredConfirmations(100, 102, Number.NaN), false);
});
