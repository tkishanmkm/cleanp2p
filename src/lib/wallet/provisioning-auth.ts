import { timingSafeEqual } from 'node:crypto';

const MIN_SERVICE_SECRET_BYTES = 32;

/**
 * Verify the dedicated service bearer used by the database wallet-provisioning
 * trigger. This is intentionally separate from Supabase user JWT validation:
 * the trigger cannot mint a user access token.
 */
export function isWalletProvisioningServiceBearer(
  authorizationHeader: string | null | undefined,
  expectedSecret: string | null | undefined
): boolean {
  if (!authorizationHeader || typeof expectedSecret !== 'string') {
    return false;
  }

  const secret = expectedSecret.trim();
  if (Buffer.byteLength(secret, 'utf8') < MIN_SERVICE_SECRET_BYTES) {
    return false;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader);
  if (!match) {
    return false;
  }

  const provided = Buffer.from(match[1], 'utf8');
  const expected = Buffer.from(secret, 'utf8');

  // timingSafeEqual throws when lengths differ; reject those before the
  // constant-time comparison.
  if (provided.byteLength !== expected.byteLength) {
    return false;
  }

  return timingSafeEqual(provided, expected);
}
