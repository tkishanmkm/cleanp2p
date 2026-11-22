import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const MAX_CAPTCHA_BODY_BYTES = 8 * 1024;

async function readBoundedBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_CAPTCHA_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CAPTCHA_BODY_BYTES) {
      return NextResponse.json({ success: false, error: 'Security verification request is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ success: false, error: 'Security verification request is too large.' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'Malformed security verification request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid security verification request.' }, { status: 400 });
    }

    const token = (body as Record<string, unknown>).token;
    if (typeof token !== 'string' || token.trim().length < 10 || token.length > 4096) {
      return NextResponse.json(
        { success: false, error: 'Security CAPTCHA verification is required.' },
        { status: 400 }
      );
    }

    const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY?.trim();
    const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY?.trim();
    if (!hcaptchaSecret || !hcaptchaSitekey) {
      console.error('[ADMIN CAPTCHA] Server-side CAPTCHA configuration is missing; rejecting request.');
      return NextResponse.json(
        { success: false, error: 'Security verification is temporarily unavailable.' },
        { status: 503 }
      );
    }

    const verificationBody = new URLSearchParams({
      secret: hcaptchaSecret,
      response: token.trim(),
      sitekey: hcaptchaSitekey,
    });

    let verifyData: { success?: boolean };
    try {
      const verifyResponse = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: verificationBody,
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      });

      if (!verifyResponse.ok) {
        console.error('[ADMIN CAPTCHA] Provider verification unavailable:', verifyResponse.status);
        return NextResponse.json(
          { success: false, error: 'Security verification is temporarily unavailable.' },
          { status: 503 }
        );
      }

      verifyData = await verifyResponse.json();
    } catch (error) {
      console.error('[ADMIN CAPTCHA] Provider verification failed:', error instanceof Error ? error.name : 'UnknownError');
      return NextResponse.json(
        { success: false, error: 'Security verification is temporarily unavailable.' },
        { status: 503 }
      );
    }

    if (verifyData?.success !== true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Security CAPTCHA validation failed or expired. Please solve the challenge again.',
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { success: true },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[ADMIN CAPTCHA] Server error:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json(
      { success: false, error: 'Error validating security challenge. Please try again.' },
      { status: 503 }
    );
  }
}
