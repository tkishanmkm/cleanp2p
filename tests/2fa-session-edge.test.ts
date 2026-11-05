import assert from 'node:assert/strict';
import {
  createAdmin2FASessionToken,
  verifyAdmin2FASessionToken,
} from '../src/lib/admin-2fa-session';
import {
  createUser2FASessionToken,
  verifyUser2FASessionToken,
} from '../src/lib/user-2fa-session';
import {
  verifyAdmin2FASessionTokenEdge,
  verifyUser2FASessionTokenEdge,
} from '../src/lib/2fa-session-edge';

async function main() {
  process.env.ADMIN_2FA_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.USER_2FA_ENCRYPTION_KEY = 'b'.repeat(64);

  // ISO timestamps contain colons; they must be encoded in the token format.
  const adminId = '00000000-0000-4000-8000-000000000001';
  const adminVersion = '2026-10-17T17:12:34.567Z';
  const adminToken = createAdmin2FASessionToken(adminId, adminVersion);
  assert.equal(verifyAdmin2FASessionToken(adminToken, adminId, adminVersion).valid, true);
  assert.equal((await verifyAdmin2FASessionTokenEdge(adminToken, adminId, adminVersion)).valid, true);
  assert.equal((await verifyAdmin2FASessionTokenEdge(adminToken, '00000000-0000-4000-8000-000000000002', adminVersion)).valid, false);
  assert.equal((await verifyAdmin2FASessionTokenEdge(adminToken, adminId, '2026-10-17T17:12:35.000Z')).valid, false);

  const userId = '00000000-0000-4000-8000-000000000003';
  const userVersion = '2026-10-17T17:13:14.159Z';
  const userToken = createUser2FASessionToken(userId, userVersion);
  assert.equal(verifyUser2FASessionToken(userToken, userId, userVersion).valid, true);
  assert.equal((await verifyUser2FASessionTokenEdge(userToken, userId, userVersion)).valid, true);
  assert.equal((await verifyUser2FASessionTokenEdge(userToken, userId, '2026-10-17T17:13:15.000Z')).valid, false);

  console.log('2FA session compatibility checks passed (Node and Edge Web Crypto, ISO timestamp version tags, user binding, rotation invalidation).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
