import crypto from 'crypto';

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

/** Require an explicitly configured shared secret; never silently allow unauthenticated callbacks. */
export function verifySharedWebhookSecret(request: Request, secret: string | undefined): boolean {
  if (!secret || !secret.trim()) return false;
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const headerSecret = request.headers.get('x-webhook-secret')?.trim();
  return safeEqual(bearer || headerSecret || '', secret);
}

/** Verify a hex HMAC-SHA256 signature over the exact raw request body. */
export function verifyHmacSha256(rawBody: string, signatureHeader: string | null, secret: string | undefined): boolean {
  if (!secret || !secret.trim() || !signatureHeader) return false;
  const signature = signatureHeader.replace(/^sha256=/i, '').trim();
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const supplied = Buffer.from(signature, 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
