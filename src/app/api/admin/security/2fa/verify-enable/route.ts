import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  verifyAdminTOTPToken,
  generateRecoveryPassword,
  hashRecoveryPassword,
  encryptAdminTOTPSecret,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { createAdmin2FASessionToken, setAdmin2FACookie } from '@/lib/admin-2fa-session';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { readAdmin2FABody, isActiveAdminProfile } from '@/lib/admin-2fa-request';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await verifyServerAdmin(req);
    if (!adminAuth.authorized) return adminAuth.response!;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readAdmin2FABody(req);
    if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    if (Object.keys(parsedBody.body).some((key) => key !== 'code')) {
      return NextResponse.json({ error: 'Unsupported 2FA request field.' }, { status: 400 });
    }
    const code = parsedBody.body.code;
    if (typeof code !== 'string' || !/^\d{6,8}$/.test(code)) {
      return NextResponse.json({ error: 'A valid 6-8 digit authenticator code is required.' }, { status: 400 });
    }

    const adminId = user.id;
    const adminEmail = user.email || 'admin';
    const adminDb = createAdminClient();

    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('id, admin_2fa_secret, two_factor_secret, is_admin, is_admin_account, role, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status, admin_2fa_enabled, is_2fa_enabled')
      .eq('id', adminId)
      .single();

    if (profileError) {
      return NextResponse.json({ error: 'Administrator profile could not be verified.' }, { status: 503 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'Administrator profile could not be verified.' }, { status: 503 });
    }
    if (adminAuth.supportAdmin === true) {
      return NextResponse.json({ error: 'Support administrators cannot enroll full-administrator 2FA credentials.' }, { status: 403 });
    }
    if (!isActiveAdminProfile(profile)) {
      return NextResponse.json({ error: 'This administrator account is disabled.' }, { status: 403 });
    }
    if (profile.admin_2fa_enabled || profile.is_2fa_enabled) {
      return NextResponse.json({ error: 'Administrator 2FA is already enabled.' }, { status: 409 });
    }
    let rateLimit;
    try {
      rateLimit = await checkAdmin2FARateLimit(adminId);
    } catch {
      return NextResponse.json({ error: 'Administrator 2FA protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const auditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_ENABLE_RATE_LIMITED',
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) return NextResponse.json({ error: 'Rate-limited enrollment could not be securely audited.' }, { status: 503 });
      return NextResponse.json({ error: 'Too many 2FA attempts. Try again later.', retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429 });
    }

    const secret = profile.admin_2fa_secret || profile.two_factor_secret;
    if (!secret) {
      return NextResponse.json({ error: 'No 2FA enrollment pending. Please start 2FA setup first.' }, { status: 400 });
    }

    const isValid = verifyAdminTOTPToken(secret, code);
    if (!isValid) {
      const remaining = rateLimit;
      const auditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_VERIFICATION_FAILED',
        details: { reason: 'Invalid TOTP code during enablement', remainingAttempts: remaining.remainingAttempts },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) {
        return NextResponse.json({ error: '2FA failure could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Invalid 6-digit authenticator code', remainingAttempts: remaining.remainingAttempts }, { status: 400 });
    }

    // Code is valid! Generate Recovery Password and enable 2FA
    const rawRecoveryPassword = generateRecoveryPassword();
    const recoveryHash = hashRecoveryPassword(rawRecoveryPassword);
    const nowIso = new Date().toISOString();
    const encryptedSecret = encryptAdminTOTPSecret(secret);

    const { data: enableResult, error: enableError } = await adminDb.rpc('enable_admin_2fa_atomic', {
      p_admin_id: adminId,
      p_expected_encrypted_secret: encryptedSecret,
      p_admin_email: adminEmail,
      p_recovery_hash: recoveryHash,
      p_now: nowIso,
    });
    if (enableError || enableResult !== true) {
      console.error('Failed to atomically enable admin 2FA:', enableError?.code || null);
      return NextResponse.json({ error: 'Failed to enable 2FA. Please try again.' }, { status: 503 });
    }
    try {
      await resetAdmin2FAFailures(adminId);
    } catch {
      return NextResponse.json({ error: '2FA was enabled but the security rate limit could not be reset. Contact support.' }, { status: 503 });
    }

    const sessionToken = createAdmin2FASessionToken(adminId, nowIso);

    const response = NextResponse.json({
      success: true,
      recoveryPassword: rawRecoveryPassword,
      message: 'Admin 2FA Authenticator successfully enabled.',
    });

    setAdmin2FACookie(response, sessionToken);
    return response;
  } catch (error: any) {
    console.error('2FA Enable Error:', error);
    return NextResponse.json({ error: error.message || 'Verification failed' }, { status: 500 });
  }
}
