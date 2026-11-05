import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { encryptUserTOTPSecret, ensureUserTOTPSecretEncrypted, consumeUserRecoveryCodeAtomic } from '@/lib/user-2fa-crypto';
import { verify2FAOTP } from '@/lib/2fa';
import { checkUser2FARateLimit, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';
import { readUser2FABody } from '@/lib/user-2fa-request';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session required' }, { status: 401 });
    }

    // Rate-limit check
    let rateLimit;
    try {
      rateLimit = await checkUser2FARateLimit(user.id);
    } catch {
      return NextResponse.json({ error: 'Two-factor protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const adminClient = getSupabaseAdminClient();
      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_rate_limited',
        details: { endpoint: '/api/auth/2fa/generate', retryAfterSeconds: rateLimit.retryAfterSeconds },
      });
      if (auditError) return NextResponse.json({ error: 'Rate-limited attempt could not be securely audited.' }, { status: 503 });

      return NextResponse.json(
        {
          error: `Too many failed attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    const adminClient = getSupabaseAdminClient();

    // Check if user already has an active 2FA configuration
    const { data: profile, error: profileError } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret, role, is_admin, is_admin_account, admin_2fa_enabled, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Account security state could not be verified.' }, { status: 503 });
    }
    if (
      profile.is_banned || profile.is_suspended || profile.is_restricted || profile.is_on_hold || profile.is_emergency_frozen || profile.is_minor_restricted ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.status || '').toLowerCase()) ||
      ['banned', 'suspended', 'restricted', 'inactive', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.account_status || '').toLowerCase())
    ) {
      return NextResponse.json({ error: 'Account is disabled.' }, { status: 403 });
    }

    const is2faActive = Boolean(
      profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled
    );
    const existingSecret = profile.totp_secret || profile.two_factor_secret;
    if (is2faActive !== Boolean(existingSecret)) {
      return NextResponse.json({ error: 'Account 2FA state is inconsistent. Contact support.' }, { status: 503 });
    }

    // -------------------------------------------------------------------------
    // CORRECTION 1: SECURE ROTATION PROOF ENFORCEMENT
    // If user already has 2FA active, require proof of existing TOTP or recovery code.
    // -------------------------------------------------------------------------
    let encryptedExistingSecret = '';
    if (is2faActive && existingSecret) {
      try {
        encryptedExistingSecret = await ensureUserTOTPSecretEncrypted(adminClient, user.id, profile);
      } catch {
        return NextResponse.json({ error: 'Account authenticator could not be securely encrypted and verified.' }, { status: 503 });
      }
      if (!encryptedExistingSecret) {
        return NextResponse.json({ error: 'Account authenticator is unavailable.' }, { status: 503 });
      }

      const parsedBody = await readUser2FABody(req);
      if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
      if (Object.keys(parsedBody.body).some((key) => !['currentTotpCode', 'currentRecoveryCode', 'currentCode', 'existingCode'].includes(key))) {
        return NextResponse.json({ error: 'Unsupported 2FA request field.' }, { status: 400 });
      }
      const { currentTotpCode, currentRecoveryCode, currentCode, existingCode } = parsedBody.body;
      const rawProof = currentTotpCode || currentRecoveryCode || currentCode || existingCode;

      if (!rawProof || typeof rawProof !== 'string' || rawProof.trim() === '') {
        return NextResponse.json(
          {
            error: 'Current authenticator OTP code or valid recovery code is required to rotate an existing 2FA secret.',
            requires_existing_2fa_proof: true,
          },
          { status: 403 }
        );
      }

      const cleanProof = rawProof.replace(/[\s-]+/g, '').trim();
      let isProofValid = false;

      // 1. Test against existing TOTP secret
      if (/^\d{6}$/.test(cleanProof)) {
        isProofValid = verify2FAOTP(encryptedExistingSecret, cleanProof, true);
      }

      // 2. Test against atomic recovery code consumption
      if (!isProofValid) {
        try {
          isProofValid = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawProof, 'rotation_authorization');
        } catch {
          return NextResponse.json({ error: 'Recovery-code verification is temporarily unavailable.' }, { status: 503 });
        }
        // The recovery-code RPC also writes the mandatory audit row atomically.
      }

      if (!isProofValid) {
        const remaining = rateLimit;
        const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rotation_proof_failed',
          details: { remainingAttempts: remaining.remainingAttempts },
        });
        if (auditError) return NextResponse.json({ error: 'Failed attempt could not be securely audited.' }, { status: 503 });

        return NextResponse.json(
          { error: 'Invalid current authenticator code or recovery code.' },
          { status: 401 }
        );
      }

      // Reset rate-limit failures on successful rotation proof
      try {
        await resetUser2FAFailures(user.id);
      } catch {
        return NextResponse.json({ error: 'Two-factor protection could not be reset.' }, { status: 503 });
      }

      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_rotation_started',
        details: {},
      });
      if (auditError) return NextResponse.json({ error: '2FA rotation could not be securely audited.' }, { status: 503 });
    } else {
      // Normal new enrollment audit
      const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
        user_id: user.id,
        action: '2fa_enrollment_started',
        details: { email: user.email },
      });
      if (auditError) return NextResponse.json({ error: '2FA enrollment could not be securely audited.' }, { status: 503 });
    }

    const email = user.email || 'user';
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Paxones (${email})`,
      issuer: 'Paxones',
    });

    const encryptedSecret = encryptUserTOTPSecret(secret.base32);

    // Upsert into pending enrollments table (10-minute expiry)
    const { data: pendingRows, error: upsertErr } = await adminClient
      .from('user_2fa_pending_enrollments')
      .upsert(
        {
          user_id: user.id,
          encrypted_secret: encryptedSecret,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
        { onConflict: 'user_id' }
      )
      .select('user_id');

    if (upsertErr || !Array.isArray(pendingRows) || pendingRows.length !== 1) {
      console.error('[User 2FA] Pending enrollment persistence failed:', upsertErr?.code || null);
      return NextResponse.json({ error: 'Could not securely save the pending 2FA enrollment.' }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      secret: secret.base32,
      otpauth_url: secret.otpauth_url,
      is_rotation: is2faActive,
    });
  } catch (err: any) {
    console.error('Error generating 2FA secret:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate 2FA secret' }, { status: 500 });
  }
}
