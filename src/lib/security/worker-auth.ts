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
 * Extracts candidate credentials from request headers and optional URL search params.
 */
export function extractCandidateTokens(
  req: Request | NextRequest,
  customHeaderNames: string[] = [],
  checkQueryParam: boolean = false
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

  // URL query credentials are intentionally never accepted: URLs commonly leak into
  // access logs, analytics, browser history, and referrer headers. Keep the option
  // parameter for source compatibility, but require Authorization/custom headers.
  void checkQueryParam;

  return candidates;
}

export interface VerifyWorkerAuthOptions {
  allowedSecrets: (string | undefined | null)[];
  customHeaderNames?: string[];
  checkQueryParam?: boolean;
}

export interface WorkerAuthResult {
  authorized: boolean;
  error?: string;
}

/**
 * Authoritatively verifies worker credentials against configured secrets.
 * 
 * Rules:
 * 1. Fails closed if NO secrets are configured or all are empty. Never allows unauthenticated bypass.
 * 2. Extracts candidate credentials from Authorization Bearer, custom headers, or optional query params.
 * 3. Compares tokens using timing-safe comparison.
 * 4. Never logs secret values.
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

  // FAIL CLOSED: If no valid secret is configured on the server, reject immediately.
  if (validSecrets.length === 0) {
    return {
      authorized: false,
      error: 'Worker secret is not configured on server. Request failed closed.',
    };
  }

  const defaultHeaders = ['x-worker-secret', 'x-service-key'];
  const allHeaders = Array.from(new Set([...defaultHeaders, ...(options.customHeaderNames || [])]));
  const candidateTokens = extractCandidateTokens(req, allHeaders, options.checkQueryParam);

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
