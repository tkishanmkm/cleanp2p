import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { encryptUserTOTPSecret, consumeUserRecoveryCodeAtomic } from '@/lib/user-2fa-crypto';
import { verify2FAOTP } from '@/lib/2fa';
import { checkUser2FARateLimit, recordUser2FAFailure, resetUser2FAFailures } from '@/lib/user-2fa-rate-limit';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized: Session required' }, { status: 401 });
    }

    // Rate-limit check
    const rateLimit = checkUser2FARateLimit(user.id);
    if (!rateLimit.allowed) {
      const adminClient = getSupabaseAdminClient();
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rate_limited',
          details: { endpoint: '/api/auth/2fa/generate', retryAfterSeconds: rateLimit.retryAfterSeconds },
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

    const adminClient = getSupabaseAdminClient();

    // Check if user already has an active 2FA configuration
    const { data: profile } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(
      profile?.is_2fa_enabled || profile?.is_mfa_enabled || profile?.two_factor_enabled
    );
    const existingSecret = profile?.totp_secret || profile?.two_factor_secret;

    // -------------------------------------------------------------------------
    // CORRECTION 1: SECURE ROTATION PROOF ENFORCEMENT
    // If user already has 2FA active, require proof of existing TOTP or recovery code.
    // -------------------------------------------------------------------------
    if (is2faActive && existingSecret) {
      const body = await req.json().catch(() => ({}));
      const { currentTotpCode, currentRecoveryCode, currentCode, existingCode } = body;
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
      if (cleanProof.length >= 4 && cleanProof.length <= 8) {
        isProofValid = verify2FAOTP(existingSecret, cleanProof, true);
      }

      // 2. Test against atomic recovery code consumption
      if (!isProofValid) {
        isProofValid = await consumeUserRecoveryCodeAtomic(adminClient, user.id, rawProof);
        if (isProofValid) {
          try {
            await adminClient.from('user_security_audit_logs').insert({
              user_id: user.id,
              action: '2fa_recovery_code_used',
              details: { purpose: 'rotation_authorization' },
            });
          } catch {}
        }
      }

      if (!isProofValid) {
        recordUser2FAFailure(user.id);
        try {
          await adminClient.from('user_security_audit_logs').insert({
            user_id: user.id,
            action: '2fa_rotation_proof_failed',
            details: {},
          });
        } catch {}

        return NextResponse.json(
          { error: 'Invalid current authenticator code or recovery code.' },
          { status: 401 }
        );
      }

      // Reset rate-limit failures on successful rotation proof
      resetUser2FAFailures(user.id);

      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_rotation_started',
          details: {},
        });
      } catch {}
    } else {
      // Normal new enrollment audit
      try {
        await adminClient.from('user_security_audit_logs').insert({
          user_id: user.id,
          action: '2fa_enrollment_started',
          details: { email: user.email },
        });
      } catch {}
    }

    const email = user.email || 'user';
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Paxones (${email})`,
      issuer: 'Paxones',
    });

    const encryptedSecret = encryptUserTOTPSecret(secret.base32);

    // Upsert into pending enrollments table (10-minute expiry)
    const { error: upsertErr } = await adminClient
      .from('user_2fa_pending_enrollments')
      .upsert(
        {
          user_id: user.id,
          encrypted_secret: encryptedSecret,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        },
        { onConflict: 'user_id' }
      );

    if (upsertErr) {
      console.warn('Notice: pending enrollments record:', upsertErr);
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
