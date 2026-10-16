import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import {
  verifyAdminTOTPToken,
  verifyRecoveryPasswordHash,
  hashRecoveryPassword,
  generateRecoveryPassword,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { createAdmin2FASessionToken, setAdmin2FACookie } from '@/lib/admin-2fa-session';
import { checkAdmin2FARateLimit, recordAdmin2FAFailure, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required. Please sign in.' },
        { status: 401 }
      );
    }

    const adminId = session.user.id;
    const adminEmail = session.user.email || 'admin';
    const adminDb = getSupabaseAdminClient();

    // 1. Authoritative Admin Role Verification
    const { data: profile, error: profError } = await adminDb
      .from('profiles')
      .select('id, email, role, is_admin, is_admin_account, admin_2fa_enabled, is_2fa_enabled, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash, admin_2fa_recovery_updated_at')
      .eq('id', adminId)
      .single();

    if (profError || !profile) {
      return NextResponse.json({ success: false, error: 'Admin profile not found' }, { status: 404 });
    }

    const isAdmin = Boolean(
      profile.role === 'admin' ||
      profile.is_admin === true ||
      profile.is_admin_account === true ||
      session.user.app_metadata?.role === 'admin'
    );

    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Administrator privileges required.' },
        { status: 403 }
      );
    }

    const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);

    // If 2FA is disabled for this admin, they do not need to solve a challenge
    if (!is2FAEnabled) {
      const response = NextResponse.json({
        success: true,
        is2FAEnabled: false,
        message: 'Admin 2FA is not enabled for this account.',
      });
      return response;
    }

    // 2. Rate Limiting Check
    const rateLimit = checkAdmin2FARateLimit(adminId);
    if (!rateLimit.allowed) {
      const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
      await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_CHALLENGE_RATE_LIMITED',
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        ipAddress: clientIp,
      });

      return NextResponse.json(
        {
          success: false,
          error: `Too many failed 2FA verification attempts. Please try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 3. Parse and Validate Credentials
    const body = await req.json().catch(() => ({}));
    const { code, recoveryPassword } = body;

    if (!code && !recoveryPassword) {
      return NextResponse.json(
        { success: false, error: 'Please enter your 6-digit authenticator code or emergency recovery password.' },
        { status: 400 }
      );
    }

    let isChallengeValid = false;
    let authMethodUsed = '';
    let newRecoveryPassword: string | undefined;

    // A. Verify TOTP Code
    const rawSecret = profile.admin_2fa_secret || profile.two_factor_secret;
    if (code && rawSecret) {
      isChallengeValid = verifyAdminTOTPToken(rawSecret, String(code));
      if (isChallengeValid) authMethodUsed = 'totp_code';
    }

    // B. Verify Recovery Password
    if (!isChallengeValid && recoveryPassword && profile.admin_2fa_recovery_hash) {
      isChallengeValid = verifyRecoveryPasswordHash(String(recoveryPassword), profile.admin_2fa_recovery_hash);
      if (isChallengeValid) {
        authMethodUsed = 'recovery_password';

        // Rotate recovery password on emergency use
        newRecoveryPassword = generateRecoveryPassword();
        const newHash = hashRecoveryPassword(newRecoveryPassword);
        const nowIso = new Date().toISOString();

        await adminDb
          .from('profiles')
          .update({
            admin_2fa_recovery_hash: newHash,
            admin_2fa_recovery_updated_at: nowIso,
          })
          .eq('id', adminId);

        const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
        await logAdminSecurityAudit({
          adminId,
          adminEmail,
          action: 'ADMIN_2FA_RECOVERY_USED',
          details: { timestamp: nowIso },
          ipAddress: clientIp,
        });
      }
    }

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

    // 4. Handle Failed Verification
    if (!isChallengeValid) {
      const remaining = recordAdmin2FAFailure(adminId);

      await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_CHALLENGE_FAILED',
        details: { method: code ? 'totp' : 'recovery_password', remainingAttempts: remaining.remainingAttempts },
        ipAddress: clientIp,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Invalid 6-digit authenticator code or recovery password.',
          remainingAttempts: remaining.remainingAttempts,
        },
        { status: 400 }
      );
    }

    // 5. Handle Successful Verification
    resetAdmin2FAFailures(adminId);

    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_CHALLENGE_SUCCESS',
      details: { method: authMethodUsed },
      ipAddress: clientIp,
    });

    // Create cryptographically signed 2FA session token bound to admin security state
    const securityVersion = profile.admin_2fa_recovery_updated_at || profile.id;
    const sessionToken = createAdmin2FASessionToken(adminId, securityVersion);

    const response = NextResponse.json({
      success: true,
      is2FAEnabled: true,
      method: authMethodUsed,
      newRecoveryPassword,
      message: 'Admin 2FA verification successful.',
    });

    // Issue HttpOnly, Secure, SameSite=Lax cookie
    setAdmin2FACookie(response, sessionToken);

    return response;
  } catch (err: any) {
    console.error('Admin 2FA Challenge Error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error during 2FA verification.' },
      { status: 500 }
    );
  }
}
