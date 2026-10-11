import { NextRequest, NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { decryptUserTOTPSecret, consumeUserRecoveryCodeAtomic } from '@/lib/user-2fa-crypto';
import { createUser2FASessionToken, setUser2FACookie } from '@/lib/user-2fa-session';
import { checkUser2FARateLimit, recordUser2FAFailure, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';

export const dynamic = 'force-dynamic';

function getSafeRedirectUrl(nextUrl: string | null | undefined): string {
  if (!nextUrl || typeof nextUrl !== 'string') return '/dashboard';
  const clean = nextUrl.trim();
  if (clean.startsWith('/') && !clean.startsWith('//') && !clean.includes('\\')) {
    // Avoid redirecting back to login / auth challenge
    if (clean.startsWith('/login') || clean.startsWith('/auth')) {
      return '/dashboard';
    }
    return clean;
  }
  return '/dashboard';
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Session expired or unauthenticated. Please log in again.' },
        { status: 401 }
      );
    }

    const adminClient = getSupabaseAdminClient();

    // 1. Rate Limiting Check
    const rateLimit = checkUser2FARateLimit(user.id);
    if (!rateLimit.allowed) {
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rate_limited',
          details: { endpoint: '/api/auth/2fa/login-verify', retryAfterSeconds: rateLimit.retryAfterSeconds },
        });
      } catch {}

      return NextResponse.json(
        {
          success: false,
          error: `Too many failed verification attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 2. Fetch authoritative user profile & 2FA state
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id, email, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, updated_at, status, is_banned')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ success: false, error: 'User profile not found' }, { status: 404 });
    }

    if (profile.is_banned || profile.status === 'banned') {
      return NextResponse.json({ success: false, error: 'Account is banned or suspended.' }, { status: 403 });
    }

    const is2faActive = Boolean(
      profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled
    );
    const existingSecret = profile.totp_secret || profile.two_factor_secret;
    const securityVersion = profile.updated_at || user.id;

    // If 2FA is not active on profile, issue 2FA session token directly
    if (!is2faActive || !existingSecret) {
      const destination = getSafeRedirectUrl(req.nextUrl.searchParams.get('next'));
      const token = createUser2FASessionToken(user.id, securityVersion);
      const res = NextResponse.json({ success: true, redirect: destination });
      setUser2FACookie(res, token);
      return res;
    }

    // 3. Parse and validate input credential
    const body = await req.json().catch(() => ({}));
    const { code, totpCode, recoveryCode, token: bodyToken, next } = body;
    const rawCredential = code || totpCode || recoveryCode || bodyToken;

    if (!rawCredential || typeof rawCredential !== 'string' || rawCredential.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Authenticator OTP code or recovery code is required.' },
        { status: 400 }
      );
    }

    const cleanInput = rawCredential.replace(/[\s-]+/g, '').trim();
    let isAuthorized = false;
    let usedRecovery = false;

    // 4. Test TOTP verification
    const decryptedSecret = decryptUserTOTPSecret(existingSecret);
    if (decryptedSecret && cleanInput.length >= 4 && cleanInput.length <= 8) {
      isAuthorized = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: cleanInput,
        window: 2,
      });
    }

    // 5. Test atomic recovery code consumption if TOTP did not match
    if (!isAuthorized) {
      isAuthorized = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawCredential);
      if (isAuthorized) {
        usedRecovery = true;
      }
    }

    if (!isAuthorized) {
      recordUser2FAFailure(user.id);
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_verify_failed',
          details: { context: 'login_challenge' },
        });
      } catch {}

      return NextResponse.json(
        { success: false, error: 'Invalid authenticator code or recovery code. Please try again.' },
        { status: 400 }
      );
    }

    // 6. Reset rate limiter on successful verification
    resetUser2FAFailures(user.id);

    // 7. Log audit event
    try {
      await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: usedRecovery ? '2fa_recovery_code_used' : '2fa_login_successful',
        details: { context: 'login_challenge', usedRecovery },
      });
    } catch {}

    // 8. Issue signed user 2FA session token
    const token = createUser2FASessionToken(user.id, securityVersion);
    const destination = getSafeRedirectUrl(next || req.nextUrl.searchParams.get('next'));

    const res = NextResponse.json({
      success: true,
      redirect: destination,
      message: 'Two-factor authentication verified successfully',
    });

    setUser2FACookie(res, token);
    return res;
  } catch (err: any) {
    console.error('Error during login 2FA verification:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal authentication error' },
      { status: 500 }
    );
  }
}
