import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractClientTelemetry, logSecurityEvent } from '@/lib/telemetry';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';

export const dynamic = 'force-dynamic';

const MAX_REGISTRATION_BODY_BYTES = 12 * 1024;

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
      if (totalBytes > MAX_REGISTRATION_BODY_BYTES) {
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
    try {
      await assertPlatformControlAllowed('signup');
    } catch (guardErr: any) {
      return NextResponse.json(
        {
          error: guardErr.message || 'New user registration is temporarily disabled by administrator.',
          code: guardErr.code || 'PLATFORM_SIGNUP_DISABLED',
        },
        { status: guardErr.statusCode || 403 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REGISTRATION_BODY_BYTES) {
      return NextResponse.json({ error: 'Registration request is too large.' }, { status: 413 });
    }
    const rawBody = await readBoundedBody(req);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Registration request is too large.' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed registration request.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid registration request.' }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const dob = typeof record.dob === 'string' ? record.dob.trim() : '';
    const email = typeof record.email === 'string' ? record.email.trim().toLowerCase() : '';
    const captchaToken = typeof record.captchaToken === 'string' ? record.captchaToken.trim() : '';
    const telemetry = extractClientTelemetry(req);

    if (name.length < 2 || name.length > 100 || /[%_\\\u0000-\u001f\u007f]/u.test(name)) {
      return NextResponse.json({ error: 'Enter a valid legal name.' }, { status: 400 });
    }
    if (
      email.length < 6 ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return NextResponse.json({ error: 'Enter a valid date of birth.' }, { status: 400 });
    }
    const birthDate = new Date(`${dob}T00:00:00.000Z`);
    if (Number.isNaN(birthDate.getTime()) || birthDate.toISOString().slice(0, 10) !== dob) {
      return NextResponse.json({ error: 'Enter a valid date of birth.' }, { status: 400 });
    }

    const now = new Date();
    let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
    if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) age--;
    if (age < 18) {
      return NextResponse.json({
        error: 'Platform policy requires users to be at least 18 years of age. Minors are not permitted to register.',
        isMinor: true,
        code: 'UNDER_18_PROHIBITED',
      }, { status: 403 });
    }

    // hCaptcha must be verified server-side; a client-side widget alone is not a control.
    const hcaptchaSecret = process.env.HCAPTCHA_SECRET_KEY?.trim();
    const hcaptchaSitekey = process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY?.trim();
    if (!hcaptchaSecret || !hcaptchaSitekey) {
      console.error('[REGISTRATION_CHECK] hCaptcha secret or expected sitekey is not configured; rejecting identity check.');
      return NextResponse.json({ error: 'Registration verification is temporarily unavailable.' }, { status: 503 });
    }
    if (!captchaToken) {
      return NextResponse.json({ error: 'Please complete the hCaptcha verification.' }, { status: 400 });
    }

    let captchaVerified = false;
    try {
      const captchaBody = new URLSearchParams({
        secret: hcaptchaSecret,
        response: captchaToken,
        sitekey: hcaptchaSitekey,
      });

      const captchaResponse = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: captchaBody.toString(),
        signal: AbortSignal.timeout(5000),
      });
      if (captchaResponse.ok) {
        const captchaResult = await captchaResponse.json();
        captchaVerified = captchaResult?.success === true;
      }
    } catch (error) {
      console.error('[REGISTRATION_CHECK] hCaptcha verification unavailable:', error);
      return NextResponse.json({ error: 'Registration verification is temporarily unavailable.' }, { status: 503 });
    }
    if (!captchaVerified) {
      return NextResponse.json({ error: 'Security verification failed. Please retry the hCaptcha challenge.' }, { status: 403 });
    }

    const adminSupabase = createAdminClient();
    const cleanName = name.toLocaleLowerCase('en-US');

    // Do not trust a client-supplied userId to exclude or suspend another account.
    // Query only the exact normalized identity candidate rather than downloading profiles.
    const { data: duplicates, error: queryError } = await adminSupabase
      .from('profiles')
      .select('id')
      .ilike('full_name', cleanName)
      .or(`dob.eq.${dob},date_of_birth.eq.${dob}`)
      .limit(1);

    if (queryError) {
      console.error('[REGISTRATION_CHECK] Identity lookup failed; rejecting registration check.');
      return NextResponse.json({ error: 'Registration verification is temporarily unavailable.' }, { status: 503 });
    }

    if (duplicates?.length) {
      try {
        await logSecurityEvent({
          userId: null,
          action: 'DUPLICATE_IDENTITY_REGISTRATION_ATTEMPT_BLOCKED',
          eventType: 'SUSPICIOUS_REGISTRATION_FRAUD',
          ip: telemetry.ip,
          userAgent: telemetry.userAgent,
          browser: telemetry.browser,
          os: telemetry.os,
          deviceType: telemetry.deviceType,
          language: telemetry.language,
          isSuspicious: true,
          suspicionReason: 'Registration identity matched an existing profile.',
          metadata: { endpoint: '/api/auth/validate-registration' },
        });
      } catch (logError) {
        console.error('[REGISTRATION_CHECK] Security event logging failed.');
      }

      // Do not disclose the matched account or mutate/suspend any existing profile.
      return NextResponse.json({
        valid: false,
        error: 'We could not verify these registration details. Please check your information or contact support.',
        code: 'IDENTITY_CHECK_FAILED',
      }, { status: 409 });
    }

    // Issue a five-minute, single-use proof bound to the exact normalized email,
    // legal name and DOB. The auth.users trigger consumes it in the same transaction
    // that creates the account, so OAuth/direct Auth signups cannot bypass validation.
    const registrationProof = randomBytes(32).toString('hex');
    const registrationProofHash = createHash('sha256')
      .update(registrationProof, 'utf8')
      .digest('hex');
    const { data: proofIssued, error: proofIssueError } = await adminSupabase.rpc(
      'issue_registration_proof',
      {
        p_proof_hash: registrationProofHash,
        p_email: email,
        p_full_name: name,
        p_date_of_birth: dob,
      }
    );
    if (proofIssueError || proofIssued !== true) {
      console.error('[REGISTRATION_CHECK] One-time registration proof could not be issued:', proofIssueError?.code || 'invalid_rpc_response');
      return NextResponse.json({ error: 'Registration verification is temporarily unavailable.' }, { status: 503 });
    }

    try {
      await logSecurityEvent({
        userId: null,
        action: 'REGISTRATION_IDENTITY_VALIDATED',
        eventType: 'AUTH_VALIDATION',
        ip: telemetry.ip,
        userAgent: telemetry.userAgent,
        browser: telemetry.browser,
        os: telemetry.os,
        deviceType: telemetry.deviceType,
        language: telemetry.language,
        isSuspicious: false,
        metadata: { endpoint: '/api/auth/validate-registration', identity_check: 'passed' },
      });
    } catch (logError) {
      console.error('[REGISTRATION_CHECK] Security event logging failed.');
    }

    return NextResponse.json({ valid: true, registrationProof, message: 'Identity validated successfully.' }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (err: any) {
    console.error('[REGISTRATION_CHECK] Server exception:', err);
    return NextResponse.json({ error: 'Registration verification is temporarily unavailable.' }, { status: 503 });
  }
}
