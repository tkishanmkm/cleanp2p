import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { decryptUserTOTPSecret, ensureUserTOTPSecretEncrypted, hashUserRecoveryCode, hashLegacyUserRecoveryCode } from '@/lib/user-2fa-crypto';
import { checkUser2FARateLimit, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';
import { readUser2FABody } from '@/lib/user-2fa-request';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session authentication required' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();
    let rateLimit;
    try {
      rateLimit = await checkUser2FARateLimit(user.id);
    } catch {
      return NextResponse.json({ error: 'Two-factor protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_rate_limited',
        details: { endpoint: '/api/auth/2fa/disable', retryAfterSeconds: rateLimit.retryAfterSeconds },
      });
      if (auditError) {
        return NextResponse.json({ error: 'The rate-limited attempt could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json(
        {
          error: `Too many failed attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const parsedBody = await readUser2FABody(req);
    if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    if (Object.keys(parsedBody.body).some((key) => !['token', 'code', 'totpCode', 'recoveryCode'].includes(key))) {
      return NextResponse.json({ error: 'Unsupported 2FA request field.' }, { status: 400 });
    }
    const { token, code, totpCode, recoveryCode } = parsedBody.body;
    const rawToken = token || code || totpCode || recoveryCode;
    if (typeof rawToken !== 'string' || rawToken.length > 128 || rawToken.trim() === '') {
      return NextResponse.json({ error: 'Current OTP code or recovery code is required to disable 2FA' }, { status: 400 });
    }

    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('totp_secret, two_factor_secret, role, is_admin, is_admin_account, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Account security state could not be verified.' }, { status: 503 });
    }
    if (
      profile.is_banned ||
      profile.is_suspended ||
      profile.is_restricted ||
      profile.is_on_hold ||
      profile.is_emergency_frozen ||
      profile.is_minor_restricted ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.status || '').toLowerCase()) ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.account_status || '').toLowerCase())
    ) {
      return NextResponse.json({ error: 'Account is disabled.' }, { status: 403 });
    }

    const is2FAEnabled = Boolean(profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled);
    const existingSecret = profile.totp_secret || profile.two_factor_secret;
    if (!is2FAEnabled || !existingSecret) {
      return NextResponse.json({ error: '2FA is not currently enabled on this account' }, { status: 409 });
    }

    let encryptedExistingSecret = '';
    try {
      encryptedExistingSecret = await ensureUserTOTPSecretEncrypted(adminClient, user.id, profile);
    } catch {
      return NextResponse.json({ error: 'Account authenticator could not be securely encrypted and verified.' }, { status: 503 });
    }
    if (!encryptedExistingSecret) {
      return NextResponse.json({ error: 'Account authenticator is unavailable.' }, { status: 503 });
    }

    const cleanInput = rawToken.replace(/[\s-]+/g, '').trim();
    const decryptedSecret = decryptUserTOTPSecret(encryptedExistingSecret);
    const isTotpValid = /^\d{6}$/.test(cleanInput) && decryptedSecret
      ? speakeasy.totp.verify({
          secret: decryptedSecret,
          encoding: 'base32',
          token: cleanInput,
          window: 1,
        })
      : false;

    // A failed six-digit TOTP is not a recovery code. Validate its format before
    // invoking the hash helper so invalid OTPs are audited and return 400, not 500.
    if (!isTotpValid && !/^[A-Z2-9]{8,64}$/i.test(cleanInput)) {
      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_disable_failed',
        details: { reason: 'invalid_credentials', remainingAttempts: rateLimit.remainingAttempts },
      });
      if (auditError) {
        return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json(
        { error: 'Invalid authenticator code or recovery code', remainingAttempts: rateLimit.remainingAttempts },
        { status: 400 }
      );
    }

    // Recovery hashes are consumed only by the atomic database disable RPC.
    const method = isTotpValid ? 'totp' : 'recovery_code';
    const recoveryHash = isTotpValid ? null : hashUserRecoveryCode(cleanInput);
    const legacyRecoveryHash = isTotpValid ? null : hashLegacyUserRecoveryCode(cleanInput);
    const { data: disableResult, error: disableError } = await adminClient.rpc('disable_user_2fa_atomic', {
      p_user_id: user.id,
      p_recovery_code_hash: recoveryHash,
      p_method: method,
      p_legacy_code_hash: legacyRecoveryHash,
    });

    if (disableError || disableResult !== true) {
      if (!disableError && disableResult === false) {
        const remaining = rateLimit;
        const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_disable_failed',
          details: { reason: 'invalid_credentials', remainingAttempts: remaining.remainingAttempts },
        });
        if (auditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });
        return NextResponse.json({ error: 'Invalid authenticator code or recovery code', remainingAttempts: remaining.remainingAttempts }, { status: 400 });
      }
      console.error('[User 2FA] Atomic disable operation failed:', disableError?.code || null);
      return NextResponse.json({ error: 'Could not safely disable 2FA. Please contact support.' }, { status: 503 });
    }

    try {
      await resetUser2FAFailures(user.id);
    } catch {
      return NextResponse.json({ error: '2FA was disabled but the rate-limit state could not be reset. Contact support.' }, { status: 503 });
    }

    return NextResponse.json({ success: true, message: 'Two-factor authentication has been disabled' });
  } catch (error: any) {
    console.error('[User 2FA] Disable failed:', error?.message || 'unknown error');
    return NextResponse.json({ error: 'Failed to disable two-factor authentication.' }, { status: 500 });
  }
}
