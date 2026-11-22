import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  decryptUserTOTPSecret,
  ensureUserTOTPSecretEncrypted,
  generateUserRecoveryCodes,
  hashUserRecoveryCode,
  consumeUserRecoveryCodeAtomic,
} from '@/lib/user-2fa-crypto';
import { checkUser2FARateLimit, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';
import { readUser2FABody } from '@/lib/user-2fa-request';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session authentication required' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: accountProfile, error: accountProfileError } = await adminClient
      .from('profiles')
      .select('is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (accountProfileError || !accountProfile) {
      return NextResponse.json({ error: 'Account security state could not be verified.' }, { status: 503 });
    }
    if (
      accountProfile.is_banned || accountProfile.is_suspended || accountProfile.is_on_hold ||
      ['banned', 'suspended', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(accountProfile.status || '').toLowerCase()) ||
      ['banned', 'suspended', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(accountProfile.account_status || '').toLowerCase())
    ) {
      return NextResponse.json({ error: 'Account is disabled.' }, { status: 403 });
    }

    // -------------------------------------------------------------------------
    // CORRECTION 3: RATE LIMITING ENFORCEMENT
    // -------------------------------------------------------------------------
    let rateLimit;
    try {
      rateLimit = await checkUser2FARateLimit(user.id);
    } catch {
      return NextResponse.json({ error: 'Two-factor protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const { error: rateLimitAuditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_rate_limited',
        details: { endpoint: '/api/auth/2fa/verify', retryAfterSeconds: rateLimit.retryAfterSeconds },
      });
      if (rateLimitAuditError) return NextResponse.json({ error: 'Rate-limited attempt could not be securely audited.' }, { status: 503 });

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

    if (!rawToken || typeof rawToken !== 'string' || rawToken.length > 128) {
      return NextResponse.json({ error: 'Verification code or recovery code is required' }, { status: 400 });
    }

    const cleanInput = rawToken.replace(/[\s-]+/g, '').trim();

    // Check if user has an active pending enrollment in holding table
    const { data: pending, error: pendingError } = await adminClient
      .from('user_2fa_pending_enrollments')
      .select('encrypted_secret, expires_at')
      .eq('user_id', user.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingError) {
      return NextResponse.json({ error: 'Pending 2FA enrollment state could not be verified.' }, { status: 503 });
    }
    const isEnrolling = Boolean(pending?.encrypted_secret);

    if (isEnrolling) {
      // -----------------------------------------------------------------------
      // ENROLLMENT / ROTATION CONFIRMATION FLOW
      // -----------------------------------------------------------------------
      let base32Secret = '';
      let encryptedToStore = '';

      if (pending?.encrypted_secret) {
        encryptedToStore = pending.encrypted_secret;
        base32Secret = decryptUserTOTPSecret(pending.encrypted_secret);
      }

      if (!base32Secret) {
        return NextResponse.json({
          error: 'No valid pending 2FA enrollment found. Please generate a new key.',
        }, { status: 400 });
      }

      // TOTP is exactly six digits; recovery codes use their separate atomic path.
      if (!/^\d{6}$/.test(cleanInput)) {
        const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_enrollment_verify_failed',
          details: { reason: 'invalid_totp_format' },
        });
        if (auditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });
        return NextResponse.json({ error: 'Enter the complete six-digit authenticator code.' }, { status: 400 });
      }

      // Verify the supplied OTP code against the pending secret
      const isVerified = speakeasy.totp.verify({
        secret: base32Secret,
        encoding: 'base32',
        token: cleanInput,
        window: 1,
      });

      if (!isVerified) {
        // The request consumed one attempt atomically in checkUser2FARateLimit.
        const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_enrollment_verify_failed',
          details: { reason: 'invalid_code' },
        });
        if (auditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });
        return NextResponse.json({
          error: 'Invalid authenticator code. Please check that the code in your authenticator app is current and try again.',
        }, { status: 400 });
      }

      // Successful verification resets failure counter
      try {
        await resetUser2FAFailures(user.id);
      } catch {
        return NextResponse.json({ error: 'Two-factor protection could not be reset.' }, { status: 503 });
      }

      // Check if user previously had 2FA active to differentiate enrollment vs rotation
      const { data: currentProfile, error: currentProfileError } = await adminClient
        .from('profiles')
        .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
        .eq('id', user.id)
        .maybeSingle();
      if (currentProfileError || !currentProfile) {
        return NextResponse.json({ error: 'Could not verify the current 2FA state.' }, { status: 503 });
      }
      if (
        currentProfile.is_banned || currentProfile.is_suspended || currentProfile.is_restricted || currentProfile.is_on_hold || currentProfile.is_emergency_frozen || currentProfile.is_minor_restricted ||
        ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(currentProfile.status || '').toLowerCase()) ||
        ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(currentProfile.account_status || '').toLowerCase())
      ) {
        return NextResponse.json({ error: 'Account is disabled.' }, { status: 403 });
      }

      const wasRotation = Boolean(
        currentProfile?.is_2fa_enabled || currentProfile?.is_mfa_enabled || currentProfile?.two_factor_enabled
      );

      // Generate recovery values locally, then persist all lifecycle changes
      // in one database transaction so partial enrollment cannot succeed.
      const recoveryCodes = generateUserRecoveryCodes(8);
      const recoveryHashes = recoveryCodes.map(hashUserRecoveryCode);
      const { data: enableResult, error: enableError } = await adminClient.rpc('enable_user_2fa_atomic', {
        p_user_id: user.id,
        p_encrypted_secret: encryptedToStore,
        p_recovery_code_hashes: recoveryHashes,
        p_is_rotation: wasRotation,
      });
      if (enableError || enableResult !== true) {
        console.error('[User 2FA] Atomic enrollment/rotation failed:', enableError?.code || null);
        return NextResponse.json({ error: '2FA enrollment could not be saved atomically. Please retry or contact support.' }, { status: 503 });
      }

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
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('totp_secret, two_factor_secret, role, is_admin, is_admin_account, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !profile) {
      return NextResponse.json({ error: 'Account security state could not be verified.' }, { status: 503 });
    }

    const is2faActive = Boolean(
      profile?.is_2fa_enabled || profile?.is_mfa_enabled || profile?.two_factor_enabled
    );
    const existingSecret = profile?.totp_secret || profile?.two_factor_secret;

    if (is2faActive !== Boolean(existingSecret)) {
      return NextResponse.json({ error: 'Account 2FA state is inconsistent. Contact support.' }, { status: 503 });
    }
    if (!is2faActive && !existingSecret) {
      return NextResponse.json({ error: '2FA is not enabled on this account' }, { status: 400 });
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

    // Attempt TOTP verification using only the versioned encrypted profile value.
    const decryptedSecret = decryptUserTOTPSecret(encryptedExistingSecret);
    let isTotpValid = false;

    if (decryptedSecret && /^\d{6}$/.test(cleanInput)) {
      isTotpValid = speakeasy.totp.verify({
        secret: decryptedSecret,
        encoding: 'base32',
        token: cleanInput,
        window: 1,
      });
    }

    if (isTotpValid) {
      try {
        await resetUser2FAFailures(user.id);
      } catch {
        return NextResponse.json({ error: 'Two-factor protection could not be reset.' }, { status: 503 });
      }
      return NextResponse.json({
        success: true,
        verified: true,
        message: 'Two-factor authentication verified successfully',
      });
    }

    // -------------------------------------------------------------------------
    // CORRECTION 2: ATOMIC RECOVERY CODE CONSUMPTION
    // -------------------------------------------------------------------------
    let recoverySuccess = false;
    try {
      recoverySuccess = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawToken, '2fa_verify');
    } catch {
      return NextResponse.json({ error: 'Recovery-code verification is temporarily unavailable.' }, { status: 503 });
    }

    if (recoverySuccess) {
      try {
        await resetUser2FAFailures(user.id);
      } catch {
        return NextResponse.json({ error: 'Two-factor protection could not be reset.' }, { status: 503 });
      }
      // Recovery consumption and its audit event were committed atomically by the RPC.

      return NextResponse.json({
        success: true,
        verified: true,
        usedRecoveryCode: true,
        message: 'Recovery code verified successfully',
      });
    }

    // Verification failed on both TOTP and recovery code
    // This request was already reserved atomically by checkUser2FARateLimit.

    const { error: failureAuditError } = await adminClient.from('user_security_audit_logs').insert({
      user_id: user.id,
      action: '2fa_verify_failed',
      details: { reason: 'invalid_credentials' },
    });
    if (failureAuditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });

    return NextResponse.json({
      error: 'Invalid authenticator code or recovery code. Please try again.',
    }, { status: 400 });
  } catch (err: any) {
    console.error('Error verifying 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to verify 2FA' }, { status: 500 });
  }
}
