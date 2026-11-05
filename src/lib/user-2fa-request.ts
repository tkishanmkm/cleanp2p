export const MAX_USER_2FA_BODY_BYTES = 8 * 1024;

export type User2FABodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: 400 | 413; error: string };

export async function readUser2FABody(request: Request): Promise<User2FABodyResult> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_USER_2FA_BODY_BYTES) {
    return { ok: false, status: 413, error: '2FA request body is too large.' };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: 'A valid 2FA request body is required.' };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_USER_2FA_BODY_BYTES) {
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
