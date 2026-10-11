import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  encryptUserTOTPSecret,
  decryptUserTOTPSecret,
  generateUserRecoveryCodes,
  hashUserRecoveryCode,
  consumeUserRecoveryCodeAtomic,
} from '@/lib/user-2fa-crypto';
import { checkUser2FARateLimit, recordUser2FAFailure, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session authentication required' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();

    // -------------------------------------------------------------------------
    // CORRECTION 3: RATE LIMITING ENFORCEMENT
    // -------------------------------------------------------------------------
    const rateLimit = checkUser2FARateLimit(user.id);
    if (!rateLimit.allowed) {
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rate_limited',
          details: { endpoint: '/api/auth/2fa/verify', retryAfterSeconds: rateLimit.retryAfterSeconds },
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
    const { secret: clientSecret, token, code, totpCode, recoveryCode } = body;
    const rawToken = token || code || totpCode || recoveryCode;

    if (!rawToken || typeof rawToken !== 'string') {
      return NextResponse.json({ error: 'Verification code or recovery code is required' }, { status: 400 });
    }

    const cleanInput = rawToken.replace(/[\s-]+/g, '').trim();

    // Check if user has an active pending enrollment in holding table
    const { data: pending } = await adminClient
      .from('user_2fa_pending_enrollments')
      .select('encrypted_secret, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isEnrolling = Boolean(pending || clientSecret);

    if (isEnrolling) {
      // -----------------------------------------------------------------------
      // ENROLLMENT / ROTATION CONFIRMATION FLOW
      // -----------------------------------------------------------------------
      let base32Secret = '';
      let encryptedToStore = '';

      if (pending?.encrypted_secret) {
        encryptedToStore = pending.encrypted_secret;
        base32Secret = decryptUserTOTPSecret(pending.encrypted_secret);
      } else if (clientSecret) {
        base32Secret = String(clientSecret).trim();
        encryptedToStore = encryptUserTOTPSecret(base32Secret);
      }

      if (!base32Secret) {
        return NextResponse.json({
          error: 'No valid pending 2FA enrollment found. Please generate a new key.',
        }, { status: 400 });
      }

      // Verify the supplied OTP code against the pending secret
      const isVerified = speakeasy.totp.verify({
        secret: base32Secret,
        encoding: 'base32',
        token: cleanInput,
        window: 2,
      });

      if (!isVerified) {
        recordUser2FAFailure(user.id);
        try {
          await adminClient.from('user_security_audit_logs').insert({
            user_id: user.id,
            action: '2fa_enrollment_verify_failed',
            details: { reason: 'invalid_code' },
          });
        } catch {}
        return NextResponse.json({
          error: 'Invalid authenticator code. Please check that the code in your authenticator app is current and try again.',
        }, { status: 400 });
      }

      // Successful verification resets failure counter
      resetUser2FAFailures(user.id);

      // Check if user previously had 2FA active to differentiate enrollment vs rotation
      const { data: currentProfile } = await adminClient
        .from('profiles')
        .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
        .eq('id', user.id)
        .maybeSingle();

      const wasRotation = Boolean(
        currentProfile?.is_2fa_enabled || currentProfile?.is_mfa_enabled || currentProfile?.two_factor_enabled
      );

      // 1. Authoritative profile update with encrypted secret and canonical flags
      const now = new Date().toISOString();
      const { error: updateError } = await adminClient
        .from('profiles')
        .update({
          is_2fa_enabled: true,
          is_mfa_enabled: true,
          two_factor_enabled: true,
          totp_secret: encryptedToStore,
          two_factor_secret: encryptedToStore,
          updated_at: now,
        })
        .eq('id', user.id);

      if (updateError) {
        console.error('Error enabling 2FA on profile:', updateError);
        return NextResponse.json({ error: 'Failed to update 2FA status in database' }, { status: 500 });
      }

      // 2. Invalidate any existing recovery codes before generating new ones
      await adminClient
        .from('user_2fa_recovery_codes')
        .update({ invalidated_at: now })
        .eq('user_id', user.id)
        .is('invalidated_at', null);

      // 3. Generate and store 8 fresh single-use hashed recovery codes
      const recoveryCodes = generateUserRecoveryCodes(8);
      const codeRows = recoveryCodes.map((rc) => ({
        user_id: user.id,
        code_hash: hashUserRecoveryCode(rc),
        created_at: now,
      }));

      await adminClient.from('user_2fa_recovery_codes').insert(codeRows);

      // 4. Clear pending enrollment
      await adminClient
        .from('user_2fa_pending_enrollments')
        .delete()
        .eq('user_id', user.id);

      // 5. Log audit record
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: wasRotation ? '2fa_rotation_successful' : '2fa_enabled',
          details: { recovery_code_count: recoveryCodes.length },
        });
      } catch {}

      return NextResponse.json({
        success: true,
        verified: true,
        is_2fa_enabled: true,
        recoveryCodes,
        message: wasRotation
          ? 'Two-factor authentication secret rotated successfully'
          : 'Two-factor authentication successfully enabled',
      });
    }

    // -------------------------------------------------------------------------
    // EXISTING 2FA CHALLENGE / VERIFICATION FLOW
    // -------------------------------------------------------------------------
    const { data: profile } = await adminClient
      .from('profiles')
      .select('totp_secret, two_factor_secret, is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(
      profile?.is_2fa_enabled || profile?.is_mfa_enabled || profile?.two_factor_enabled
    );
    const existingSecret = profile?.totp_secret || profile?.two_factor_secret;

    if (!is2faActive || !existingSecret) {
      return NextResponse.json({ error: '2FA is not enabled on this account' }, { status: 400 });
    }

    // Attempt TOTP verification
    const decryptedSecret = decryptUserTOTPSecret(existingSecret);
    let isTotpValid = false;

    if (decryptedSecret && cleanInput.length >= 4 && cleanInput.length <= 8) {
      isTotpValid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: cleanInput,
        window: 2,
      });
    }

    if (isTotpValid) {
      resetUser2FAFailures(user.id);
      return NextResponse.json({
        success: true,
        verified: true,
        message: 'Two-factor authentication verified successfully',
      });
    }

    // -------------------------------------------------------------------------
    // CORRECTION 2: ATOMIC RECOVERY CODE CONSUMPTION
    // -------------------------------------------------------------------------
    const recoverySuccess = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawToken);

    if (recoverySuccess) {
      resetUser2FAFailures(user.id);
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_recovery_code_used',
          details: { endpoint: '/api/auth/2fa/verify' },
        });
      } catch {}

      return NextResponse.json({
        success: true,
        verified: true,
        usedRecoveryCode: true,
        message: 'Recovery code verified successfully',
      });
    }

    // Verification failed on both TOTP and recovery code
    recordUser2FAFailure(user.id);

    try {
      await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_verify_failed',
        details: { reason: 'invalid_credentials' },
      });
    } catch {}

    return NextResponse.json({
      error: 'Invalid authenticator code or recovery code. Please try again.',
    }, { status: 400 });
  } catch (err: any) {
    console.error('Error verifying 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to verify 2FA' }, { status: 500 });
  }
}
