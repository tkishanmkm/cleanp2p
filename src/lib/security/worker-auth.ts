import crypto from 'crypto';
import { NextRequest } from 'next/server';

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Extract candidate credentials from headers only. URL query parameters are
 * deliberately never considered, because URLs may be persisted in access logs.
 */
export function extractCandidateTokens(
  req: Request | NextRequest,
  customHeaderNames: string[] = [],
  _checkQueryParam: boolean = false
): string[] {
  const candidates: string[] = [];

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const trimmed = authHeader.trim();
    if (trimmed.toLowerCase().startsWith('bearer ')) {
      const token = trimmed.substring(7).trim();
      if (token) candidates.push(token);
    }
  }

  for (const headerName of customHeaderNames) {
    const val = req.headers.get(headerName);
    if (val && val.trim().length > 0) {
      candidates.push(val.trim());
    }
  }

  // Intentionally ignore ?key=... even if a legacy caller passes true.
  return candidates;
}

export interface VerifyWorkerAuthOptions {
  allowedSecrets: (string | undefined | null)[];
  customHeaderNames?: string[];
  /** @deprecated Query-string credentials are ignored; use headers only. */
  checkQueryParam?: boolean;
}

export interface WorkerAuthResult {
  authorized: boolean;
  error?: string;
}

/**
 * Verifies worker credentials against configured secrets.
 * Fails closed when no usable secret is configured. Credentials are accepted
 * only from Authorization: Bearer or configured headers; never from URLs.
 */
export function verifyWorkerAuth(
  req: Request | NextRequest,
  options: VerifyWorkerAuthOptions
): WorkerAuthResult {
  const validSecrets = options.allowedSecrets
    .map((s) => (s ? s.trim() : ''))
    .filter(
      (s) =>
        s.length > 0 &&
        s !== 'placeholder-key' &&
        s !== 'placeholder-secret' &&
        s !== 'placeholder-anon-key'
    );

  if (validSecrets.length === 0) {
    return {
      authorized: false,
      error: 'Worker secret is not configured on server. Request failed closed.',
    };
  }

  const defaultHeaders = ['x-worker-secret', 'x-service-key'];
  const allHeaders = Array.from(new Set([...defaultHeaders, ...(options.customHeaderNames || [])]));
  const candidateTokens = extractCandidateTokens(req, allHeaders);

  if (candidateTokens.length === 0) {
    return {
      authorized: false,
      error: 'Missing worker authentication credentials',
    };
  }

  for (const token of candidateTokens) {
    for (const secret of validSecrets) {
      if (timingSafeEqualString(token, secret)) {
        return { authorized: true };
      }
    }
  }

  return {
    authorized: false,
    error: 'Invalid worker authentication credentials',
  };
}
