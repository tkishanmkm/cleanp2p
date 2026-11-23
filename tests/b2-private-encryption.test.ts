import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptPrivateB2Data,
  encryptPrivateB2Data,
  isEncryptedPrivateB2Data,
} from '../src/lib/private-b2-encryption';

// Dedicated deterministic test key only. No real Backblaze account is contacted.
process.env.B2_PRIVATE_DATA_ENCRYPTION_KEY = '5a'.repeat(32);

test('private uploads cannot bypass storage encryption by spoofing the KYC envelope prefix', () => {
  const attackerControlledPayload = Buffer.concat([
    Buffer.from('PAXONES_KYC_V1', 'ascii'),
    Buffer.from('attacker-controlled trade attachment bytes', 'utf8'),
  ]);

  const stored = encryptPrivateB2Data(attackerControlledPayload);

  assert.ok(isEncryptedPrivateB2Data(stored), 'private upload must always receive the B2 encryption envelope');
  assert.notDeepEqual(stored, attackerControlledPayload, 'the spoofed marker must not bypass encryption');
  assert.deepEqual(decryptPrivateB2Data(stored), attackerControlledPayload, 'authorized download must recover the original attachment');
});

test('forged private-storage markers do not bypass authenticated encryption', () => {
  const forgedMarker = Buffer.concat([
    Buffer.from('PAXONES_B2_PRIVATE_V1', 'ascii'),
    Buffer.alloc(12 + 16),
    Buffer.from('untrusted bytes with a forged marker', 'utf8'),
  ]);
  const stored = encryptPrivateB2Data(forgedMarker);

  assert.notDeepEqual(stored, forgedMarker, 'an unauthenticated marker must not be trusted');
  assert.deepEqual(decryptPrivateB2Data(stored), forgedMarker);
});

test('valid existing private envelopes remain idempotent', () => {
  const payload = Buffer.from('ordinary private payload', 'utf8');
  const stored = encryptPrivateB2Data(payload);
  assert.deepEqual(encryptPrivateB2Data(stored), stored);
});

test('new KYC envelopes receive the additional private B2 storage-encryption layer', () => {
  const kycEnvelope = Buffer.concat([
    Buffer.from('PAXONES_KYC_V1', 'ascii'),
    Buffer.from('already-encrypted-KYC-payload', 'utf8'),
  ]);
  const stored = encryptPrivateB2Data(kycEnvelope);

  assert.ok(isEncryptedPrivateB2Data(stored), 'KYC payload must also receive the outer private-storage envelope');
  assert.deepEqual(decryptPrivateB2Data(stored), kycEnvelope, 'storage decryption must reveal only the encrypted KYC envelope');
});

test('legacy KYC-encrypted objects remain readable through the compatibility path', () => {
  const legacyKycEnvelope = Buffer.concat([
    Buffer.from('PAXONES_KYC_V1', 'ascii'),
    Buffer.from('legacy-encrypted-KYC-payload', 'utf8'),
  ]);
  assert.deepEqual(decryptPrivateB2Data(legacyKycEnvelope), legacyKycEnvelope);
});
