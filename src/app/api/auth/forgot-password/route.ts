import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { hashSecurityAnswer, verifySecurityAnswer } from '@/lib/security-answer';

export const dynamic = 'force-dynamic';

const MAX_RECOVERY_BODY_BYTES = 8 * 1024;
const GENERIC_RESPONSE = {
  success: true,
  email: '',
  message: 'If the provided details match our records, a password reset link will be sent to the verified account email.',
};

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
      if (totalBytes > MAX_RECOVERY_BODY_BYTES) {
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

function getTrustedRecoveryOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com';
  const parsed = new URL(configured);
  const isLocalDevelopment = process.env.NODE_ENV === 'development'
    && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (parsed.protocol !== 'https:' && !isLocalDevelopment) {
    throw new Error('Password recovery redirect origin must use HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Password recovery redirect origin is invalid.');
  }
  return parsed.origin;
}

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RECOVERY_BODY_BYTES) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed recovery request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid recovery request.' }, { status: 400 });
    }

    const { identifier, securityAnswer, captchaToken } = body as Record<string, unknown>;
    if (
      typeof identifier !== 'string' || identifier.trim().length < 3 || identifier.length > 254 ||
      typeof captchaToken !== 'string' || captchaToken.length < 10 || captchaToken.length > 4096
    ) {
      return NextResponse.json({ error: 'Please provide your account identifier and complete the CAPTCHA.' }, { status: 400 });
    }

    const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY?.trim();
    const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY?.trim();
    if (!hcaptchaSecret || !hcaptchaSitekey) {
      console.error('[PASSWORD RECOVERY] CAPTCHA verification is not configured.');
      return NextResponse.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });
    }

    const captchaForm = new URLSearchParams({
      secret: hcaptchaSecret,
      response: captchaToken,
      sitekey: hcaptchaSitekey,
    });

    const captchaResponse = await fetch('https://api.hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: captchaForm,
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    });
    if (!captchaResponse.ok) {
      return NextResponse.json({ error: 'CAPTCHA verification is temporarily unavailable.' }, { status: 503 });
    }
    const captchaResult = await captchaResponse.json();
    if (captchaResult?.success !== true) {
      return NextResponse.json({ error: 'CAPTCHA verification failed.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const cleanIdentifier = identifier.trim();
    const isEmail = cleanIdentifier.includes('@');
    const profileQuery = admin.from('profiles')
      .select('id, security_question, security_answer_hash, security_answer')
      .limit(2);

    const { data: matchingProfiles, error: profileError } = isEmail
      ? await profileQuery.ilike('email', cleanIdentifier)
      : await profileQuery.ilike('username', cleanIdentifier);

    if (profileError) {
      console.error('[PASSWORD RECOVERY] Profile lookup failed', { code: profileError.code || null });
      return NextResponse.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });
    }

    // Do not reveal whether an account exists, has a security question, or passed
    // the answer check. A verified Auth email is the only reset destination.
    if (!Array.isArray(matchingProfiles) || matchingProfiles.length !== 1) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const profile = matchingProfiles[0];
    const hasSecurityAnswer = Boolean(profile.security_answer_hash || profile.security_answer);
    if (hasSecurityAnswer) {
      if (typeof securityAnswer !== 'string' || securityAnswer.trim().length < 1 || securityAnswer.length > 512) {
        return NextResponse.json(GENERIC_RESPONSE);
      }

      const verification = await verifySecurityAnswer(
        securityAnswer,
        profile.security_answer_hash,
        profile.security_answer
      );
      if (!verification.valid) return NextResponse.json(GENERIC_RESPONSE);

      if (verification.needsRehash) {
        const upgradedHash = await hashSecurityAnswer(securityAnswer);
        const { data: upgradedRows, error: upgradeError } = await admin
          .from('profiles')
          .update({
            security_answer_hash: upgradedHash,
            security_answer: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', profile.id)
          .select('id');

        if (upgradeError || !Array.isArray(upgradedRows) || upgradedRows.length !== 1) {
          console.error('[PASSWORD RECOVERY] Legacy security answer upgrade failed', {
            code: upgradeError?.code || null,
          });
          return NextResponse.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });
        }
      }
    }

    const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(profile.id);
    const targetEmail = authUser?.user?.email;
    if (authUserError || !targetEmail || !authUser.user.email_confirmed_at) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const redirectUrl = new URL('/auth/callback', getTrustedRecoveryOrigin());
    redirectUrl.searchParams.set('next', '/reset-password');
    const { error: resetError } = await admin.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: redirectUrl.toString(),
    });

    if (resetError) {
      console.error('[PASSWORD RECOVERY] Auth reset request failed', { code: resetError.code || null });
      return NextResponse.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });
    }

    return NextResponse.json(GENERIC_RESPONSE, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[PASSWORD RECOVERY] Request failed', {
      error: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Password recovery is temporarily unavailable.' }, { status: 503 });
  }
}
