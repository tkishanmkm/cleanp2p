import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import {
  verifyRecoveryPasswordHash,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { readAdmin2FABody, isActiveAdminProfile } from '@/lib/admin-2fa-request';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';
import { clearAdmin2FACookie } from '@/lib/admin-2fa-session';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsedBody = await readAdmin2FABody(req);
    if (!parsedBody.ok) return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    if (Object.keys(parsedBody.body).some((key) => key !== 'recoveryPassword')) {
      return NextResponse.json({ error: 'Unsupported 2FA request field.' }, { status: 400 });
    }
    const recoveryPassword = parsedBody.body.recoveryPassword;
    if (typeof recoveryPassword !== 'string' || recoveryPassword.length > 64) {
      return NextResponse.json({ error: 'A valid recovery password is required.' }, { status: 400 });
    }

    const adminId = user.id;
    const adminEmail = user.email || 'admin';
    const adminDb = createAdminClient();

    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('id, admin_2fa_recovery_hash, is_admin, is_admin_account, role, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status, admin_2fa_enabled, is_2fa_enabled')
      .eq('id', adminId)
      .single();

    if (profileError) {
      return NextResponse.json({ error: 'Administrator profile could not be verified.' }, { status: 503 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'Administrator profile could not be verified.' }, { status: 503 });
    }
    if (!isActiveAdminProfile(profile)) {
      return NextResponse.json({ error: 'This administrator account is disabled.' }, { status: 403 });
    }

    const { data: adminRows, error: adminVerificationError } = await adminDb.rpc(
      'verify_admin_login',
      { user_uuid: adminId }
    );
    if (adminVerificationError) {
      console.error('[ADMIN_2FA_RECOVERY] Canonical admin lookup failed:', adminVerificationError.code || 'unknown');
      return NextResponse.json({ error: 'Administrator privileges could not be verified.' }, { status: 503 });
    }
    const adminVerification = Array.isArray(adminRows) ? adminRows[0] : null;
    if (!adminVerification || adminVerification.is_valid !== true || adminVerification.suspended_val === true) {
      return NextResponse.json({ error: 'Forbidden: Active administrator privileges are required.' }, { status: 403 });
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
        action: 'ADMIN_2FA_RECOVERY_RATE_LIMITED',
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) return NextResponse.json({ error: 'Rate-limited recovery could not be securely audited.' }, { status: 503 });
      return NextResponse.json({ error: 'Too many 2FA attempts. Try again later.', retryAfterSeconds: rateLimit.retryAfterSeconds }, { status: 429 });
    }

    if (!profile.admin_2fa_recovery_hash) {
      return NextResponse.json({ error: 'No 2FA recovery password exists for this account' }, { status: 400 });
    }

    const isValid = verifyRecoveryPasswordHash(recoveryPassword, profile.admin_2fa_recovery_hash);
    if (!isValid) {
      const remaining = rateLimit;
      const auditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_RECOVERY_FAILED',
        details: { reason: 'Recovery password mismatch', remainingAttempts: remaining.remainingAttempts },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) {
        return NextResponse.json({ error: 'Recovery failure could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json({ error: 'Invalid 2FA recovery password', remainingAttempts: remaining.remainingAttempts }, { status: 400 });
    }

// Recovery consumes the one-time credential and disables 2FA; it does not create a dormant credential while 2FA is off.
    const nowIso = new Date().toISOString();

    const { data: recoveryResult, error: recoveryUpdateError } = await adminDb.rpc('recover_admin_2fa_atomic', {
      p_admin_id: adminId,
      p_expected_recovery_hash: profile.admin_2fa_recovery_hash,
      p_admin_email: adminEmail,
      p_now: nowIso,
    });
    if (recoveryUpdateError || recoveryResult !== true) {
      console.error('Atomic administrator 2FA recovery failed:', recoveryUpdateError?.code || null);
      return NextResponse.json(
        { error: 'Recovery credential is no longer valid or recovery could not be saved. Please contact support.' },
        { status: recoveryUpdateError ? 503 : 409 }
      );
    }
    try {
      await resetAdmin2FAFailures(adminId);
    } catch {
      return NextResponse.json({ error: '2FA recovery was completed but rate-limit state could not be reset. Contact support.' }, { status: 503 });
    }

    const response = NextResponse.json({
      success: true,
      message: '2FA emergency recovery successful. Authenticator 2FA has been disabled. Enroll a new authenticator before resuming protected administration.',
    });
    clearAdmin2FACookie(response);
    return response;
  } catch (error: any) {
    console.error('2FA Recover Error:', error);
    return NextResponse.json({ error: error.message || 'Recovery failed' }, { status: 500 });
  }
}
