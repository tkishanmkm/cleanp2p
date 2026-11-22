import type { NextRequest } from 'next/server';

export const MAX_ADMIN_2FA_BODY_BYTES = 8 * 1024;

export type Admin2FABodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

export async function readAdmin2FABody(req: NextRequest): Promise<Admin2FABodyResult> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_ADMIN_2FA_BODY_BYTES) {
    return { ok: false, status: 413, error: '2FA request body is too large.' };
  }

  const reader = req.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: 'A valid 2FA request body is required.' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ADMIN_2FA_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: '2FA request body is too large.' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: 'Could not read the 2FA request body.' };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, status: 400, error: 'Malformed 2FA request JSON.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'A valid 2FA request object is required.' };
  }

  return { ok: true, body: parsed as Record<string, unknown> };
}

export function isActiveAdminProfile(profile: Record<string, unknown>): boolean {
  const blocked = new Set([
    'banned',
    'suspended',
    'restricted',
    'frozen',
    'blocked',
    'on_hold',
    'hold',
    'deleted',
    'inactive',
    'closed',
    'deletion_pending',
  ]);
  const profileStatus = String(profile.status || '').trim().toLowerCase();
  const accountStatus = String(profile.account_status || '').trim().toLowerCase();

  return !(
    profile.is_banned === true ||
    profile.is_suspended === true ||
    profile.is_restricted === true ||
    profile.is_on_hold === true ||
    profile.is_emergency_frozen === true ||
    profile.is_minor_restricted === true ||
    profileStatus !== 'active' ||
    blocked.has(accountStatus)
  );
}
