import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { decryptUserTOTPSecret, consumeUserRecoveryCodeAtomic } from '@/lib/user-2fa-crypto';
import { checkUser2FARateLimit, recordUser2FAFailure, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session authentication required' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();

    // Rate-limit check
    const rateLimit = checkUser2FARateLimit(user.id);
    if (!rateLimit.allowed) {
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rate_limited',
          details: { endpoint: '/api/auth/2fa/disable', retryAfterSeconds: rateLimit.retryAfterSeconds },
        });
      } catch {}

      return NextResponse.json(
        {
          error: `Too many failed attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { token, code, totpCode, recoveryCode } = body;
    const rawToken = token || code || totpCode || recoveryCode;

    if (!rawToken || typeof rawToken !== 'string') {
      return NextResponse.json({ error: 'Current OTP code or recovery code is required to disable 2FA' }, { status: 400 });
    }

    const { data: profile } = await adminClient
      .from('profiles')
      .select('totp_secret, two_factor_secret, is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
      .eq('id', user.id)
      .maybeSingle();

    const is2FAEnabled = Boolean(
      profile?.is_2fa_enabled || profile?.is_mfa_enabled || profile?.two_factor_enabled
    );
    const existingSecret = profile?.totp_secret || profile?.two_factor_secret;

    if (!is2FAEnabled || !existingSecret) {
      return NextResponse.json({ error: '2FA is not currently enabled on this account' }, { status: 400 });
    }

    const cleanInput = rawToken.replace(/[\s-]+/g, '').trim();
    let isAuthorized = false;

    // Check TOTP
    const decryptedSecret = decryptUserTOTPSecret(existingSecret);
    if (decryptedSecret && cleanInput.length >= 4 && cleanInput.length <= 8) {
      isAuthorized = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: cleanInput,
        window: 2,
      });
    }

    // Check recovery code atomically if TOTP didn't pass
    if (!isAuthorized) {
      isAuthorized = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawToken);
      if (isAuthorized) {
        try {
          await adminClient.from('user_security_audit_logs').insert({
            user_id: user.id,
            action: '2fa_recovery_code_used',
            details: { endpoint: '/api/auth/2fa/disable' },
          });
        } catch {}
      }
    }

    if (!isAuthorized) {
      recordUser2FAFailure(user.id);
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_disable_failed',
          details: { reason: 'invalid_credentials' },
        });
      } catch {}
      return NextResponse.json({ error: 'Invalid authenticator code or recovery code' }, { status: 400 });
    }

    // Reset failures on success
    resetUser2FAFailures(user.id);

    const now = new Date().toISOString();

    // 1. Authoritatively update profile
    const { error: updateErr } = await adminClient
      .from('profiles')
      .update({
        is_2fa_enabled: false,
        is_mfa_enabled: false,
        two_factor_enabled: false,
        totp_secret: null,
        two_factor_secret: null,
        updated_at: now,
      })
      .eq('id', user.id);

    if (updateErr) {
      console.error('Error disabling 2FA on profile:', updateErr);
      return NextResponse.json({ error: 'Failed to disable 2FA in database' }, { status: 500 });
    }

    // 2. Invalidate all recovery codes
    await adminClient
      .from('user_2fa_recovery_codes')
      .update({ invalidated_at: now })
      .eq('user_id', user.id)
      .is('invalidated_at', null);

    // 3. Clear any pending enrollments
    await adminClient
      .from('user_2fa_pending_enrollments')
      .delete()
      .eq('user_id', user.id);

    // 4. Log audit event
    try {
      await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_disabled',
        details: {},
      });
    } catch {}

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication has been disabled',
    });
  } catch (err: any) {
    console.error('Error disabling 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to disable 2FA' }, { status: 500 });
  }
}
