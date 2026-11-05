import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { verifyAdminTOTPToken, logAdminSecurityAudit } from '@/lib/admin-security';
import { clearAdmin2FACookie } from '@/lib/admin-2fa-session';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { readAdmin2FABody, isActiveAdminProfile } from '@/lib/admin-2fa-request';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // An enrolled admin must already hold a valid signed 2FA session. Requiring
    // a fresh TOTP below is an additional confirmation for disabling protection.
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
      return NextResponse.json({ error: 'Only a current authenticator code is accepted by this endpoint. Use the separate recovery flow for a lost authenticator.' }, { status: 400 });
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
      .select('id, admin_2fa_secret, two_factor_secret, is_admin, is_admin_account, role, is_banned, is_suspended, is_on_hold, status, account_status, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret')
      .eq('id', adminId)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'Administrator profile could not be verified.' }, { status: 503 });
    }
    if (!profile.is_admin && !profile.is_admin_account && profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isActiveAdminProfile(profile)) {
      return NextResponse.json({ error: 'This administrator account is disabled.' }, { status: 403 });
    }
    if (!profile.admin_2fa_enabled && !profile.is_2fa_enabled) {
      return NextResponse.json({ error: 'Administrator 2FA is not enabled.' }, { status: 409 });
    }

    let rateLimit;
    try {
      rateLimit = await checkAdmin2FARateLimit(adminId);
    } catch {
      return NextResponse.json({ error: 'Administrator 2FA protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many 2FA attempts. Try again later.', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429 }
      );
    }

    let encryptedSecret = '';
    try {
      encryptedSecret = await ensureAdminTOTPSecretEncrypted(adminDb, adminId, profile);
    } catch {
      return NextResponse.json({ error: 'Administrator authenticator could not be securely encrypted and verified.' }, { status: 503 });
    }
    if (!encryptedSecret) {
      return NextResponse.json({ error: 'Administrator authenticator is unavailable.' }, { status: 503 });
    }
    const isValid = verifyAdminTOTPToken(encryptedSecret, code);
    if (!isValid) {
      const remaining = rateLimit;
      const failureAuditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_DISABLE_FAILED',
        details: { reason: 'Invalid TOTP code', remainingAttempts: remaining.remainingAttempts },
        ipAddress: 'server-observed',
      });
      if (!failureAuditSaved) {
        return NextResponse.json({ error: '2FA failure could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json(
        { error: 'Invalid authenticator code', remainingAttempts: remaining.remainingAttempts },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: disableResult, error: disableError } = await adminDb.rpc('disable_admin_2fa_atomic', {
      p_admin_id: adminId,
      p_expected_encrypted_secret: encryptedSecret,
      p_admin_email: adminEmail,
      p_now: nowIso,
    });

    if (disableError || disableResult !== true) {
      console.error('[Admin 2FA] Atomic disable failed:', disableError?.code || null);
      return NextResponse.json({ error: 'Could not safely disable administrator 2FA. Please retry or contact support.' }, { status: 503 });
    }

    try {
      await resetAdmin2FAFailures(adminId);
    } catch {
      return NextResponse.json({ error: '2FA was disabled but the rate-limit state could not be reset. Contact support.' }, { status: 503 });
    }

    const response = NextResponse.json({
      success: true,
      message: 'Admin 2FA has been disabled. Re-enroll before resuming protected administration.',
    });
    clearAdmin2FACookie(response);
    return response;
  } catch (error: any) {
    console.error('[Admin 2FA] Disable route failed:', error?.message || 'unknown error');
    return NextResponse.json({ error: 'Unable to complete the administrator 2FA change.' }, { status: 500 });
  }
}
