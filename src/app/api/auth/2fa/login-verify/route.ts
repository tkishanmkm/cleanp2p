import { NextRequest, NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { decryptUserTOTPSecret, ensureUserTOTPSecretEncrypted, consumeUserRecoveryCodeAtomic } from '@/lib/user-2fa-crypto';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';
import { createUser2FASessionToken, setUser2FACookie } from '@/lib/user-2fa-session';
import { checkUser2FARateLimit, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';
import { readUser2FABody } from '@/lib/user-2fa-request';

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
    let rateLimit;
    try {
      rateLimit = await checkUser2FARateLimit(user.id);
    } catch {
      return NextResponse.json({ success: false, error: 'Two-factor protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_rate_limited',
        details: { endpoint: '/api/auth/2fa/login-verify', retryAfterSeconds: rateLimit.retryAfterSeconds },
      });
      if (auditError) return NextResponse.json({ success: false, error: 'Rate-limited attempt could not be securely audited.' }, { status: 503 });

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
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('id, email, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, admin_2fa_secret, role, is_admin, is_admin_account, admin_2fa_enabled, updated_at, status, account_status, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ success: false, error: 'Account security state could not be verified.' }, { status: 503 });
    }
    if (!profile) {
      return NextResponse.json({ success: false, error: 'User profile not found' }, { status: 404 });
    }

    if (
      profile.is_banned || profile.is_suspended || profile.is_restricted || profile.is_on_hold || profile.is_emergency_frozen || profile.is_minor_restricted ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.status || '').toLowerCase()) ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.account_status || '').toLowerCase())
    ) {
      return NextResponse.json({ success: false, error: 'Account is disabled.' }, { status: 403 });
    }

    const is2faActive = Boolean(
      profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled
    );
    const existingSecret = profile.totp_secret || profile.two_factor_secret;
    const securityVersion = typeof profile.updated_at === 'string' && profile.updated_at.length > 0 ? profile.updated_at : user.id;

    // A genuinely unenrolled account may proceed. Mismatched flag/secret state
    // is a configuration/security error, not permission to bypass 2FA.
    if (is2faActive !== Boolean(existingSecret)) {
      return NextResponse.json({ success: false, error: 'Account 2FA state is inconsistent. Contact support.' }, { status: 503 });
    }

    let encryptedExistingSecret = '';
    if (is2faActive && existingSecret) {
      try {
        encryptedExistingSecret = await ensureUserTOTPSecretEncrypted(adminClient, user.id, profile);
      } catch {
        return NextResponse.json({ success: false, error: 'Account authenticator could not be securely encrypted and verified.' }, { status: 503 });
      }
      if (!encryptedExistingSecret) {
        return NextResponse.json({ success: false, error: 'Account authenticator is unavailable.' }, { status: 503 });
      }

      if (
        profile.is_admin ||
        profile.is_admin_account ||
        String(profile.role || '').toLowerCase() === 'admin' ||
        profile.admin_2fa_enabled
      ) {
        try {
          await ensureAdminTOTPSecretEncrypted(adminClient, user.id, { ...profile, totp_secret: encryptedExistingSecret });
        } catch {
          return NextResponse.json({ success: false, error: 'Administrator authenticator could not be securely separated and verified.' }, { status: 503 });
        }
      }
    }

    if (!is2faActive && !existingSecret) {
      const destination = getSafeRedirectUrl(req.nextUrl.searchParams.get('next'));
      const token = createUser2FASessionToken(user.id, securityVersion);
      const res = NextResponse.json({ success: true, redirect: destination });
      setUser2FACookie(res, token);
      return res;
    }

    // 3. Parse and validate a bounded login-challenge credential body.
    const parsedBody = await readUser2FABody(req);
    if (!parsedBody.ok) return NextResponse.json({ success: false, error: parsedBody.error }, { status: parsedBody.status });
    const body = parsedBody.body;
    const { code, totpCode, recoveryCode, token: bodyToken, next } = body;
    const rawCredential = code || totpCode || recoveryCode || bodyToken;

    if (!rawCredential || typeof rawCredential !== 'string' || rawCredential.length > 128 || rawCredential.trim() === '') {
      return NextResponse.json(
        { success: false, error: 'Authenticator OTP code or recovery code is required.' },
        { status: 400 }
      );
    }

    const cleanInput = rawCredential.replace(/[\s-]+/g, '').trim();
    let isAuthorized = false;
    let usedRecovery = false;

    // 4. Test TOTP verification
    const decryptedSecret = decryptUserTOTPSecret(encryptedExistingSecret);
    if (decryptedSecret && /^\d{6}$/.test(cleanInput)) {
      isAuthorized = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: cleanInput,
        window: 1,
      });
    }

    // 5. Test atomic recovery code consumption if TOTP did not match
    if (!isAuthorized) {
      try {
        isAuthorized = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawCredential, 'login_challenge');
      } catch {
        return NextResponse.json({ success: false, error: 'Recovery-code verification is temporarily unavailable.' }, { status: 503 });
      }
      if (isAuthorized) {
        usedRecovery = true;
      }
    }

    if (!isAuthorized) {
      // The request was reserved atomically by checkUser2FARateLimit.
      const { error: failureAuditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_verify_failed',
        details: { context: 'login_challenge' },
      });
      if (failureAuditError) return NextResponse.json({ success: false, error: 'Failed attempt could not be securely audited.' }, { status: 503 });

      return NextResponse.json(
        { success: false, error: 'Invalid authenticator code or recovery code. Please try again.' },
        { status: 400 }
      );
    }

    // 6. Reset rate limiter on successful verification
    try {
      await resetUser2FAFailures(user.id);
    } catch {
      return NextResponse.json({ success: false, error: 'Two-factor protection could not be reset.' }, { status: 503 });
    }

    // 7. Log audit event
    const { error: successAuditError } = await adminClient.from('user_security_audit_logs').insert({
      user_id: user.id,
      action: usedRecovery ? '2fa_recovery_code_used' : '2fa_login_successful',
      details: { context: 'login_challenge', usedRecovery },
    });
    if (successAuditError) return NextResponse.json({ success: false, error: '2FA verification could not be securely audited.' }, { status: 503 });

    // 8. Issue signed user 2FA session token
    const token = createUser2FASessionToken(user.id, securityVersion);
    const destination = getSafeRedirectUrl(typeof next === 'string' ? next : req.nextUrl.searchParams.get('next'));

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
