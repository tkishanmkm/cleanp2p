import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyAdminTOTPToken, logAdminSecurityAudit } from '@/lib/admin-security';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';
import { createAdmin2FASessionToken, setAdmin2FACookie } from '@/lib/admin-2fa-session';
import { readAdmin2FABody, isActiveAdminProfile } from '@/lib/admin-2fa-request';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    }

    const parsedBody = await readAdmin2FABody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ success: false, error: parsedBody.error }, { status: parsedBody.status });
    }
    if (Object.keys(parsedBody.body).some((key) => key !== 'code')) {
      return NextResponse.json({ success: false, error: 'Unsupported 2FA request field.' }, { status: 400 });
    }
    const code = parsedBody.body.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ success: false, error: 'Enter your 6-digit authenticator code.' }, { status: 400 });
    }

    const adminDb = getSupabaseAdminClient();
    const adminId = user.id;
    const adminEmail = user.email || 'support-admin';
    const [{ data: grant, error: grantError }, { data: profile, error: profileError }] = await Promise.all([
      adminDb.from('support_admin_grants')
        .select('user_id, is_enabled, emergency_uses_remaining')
        .eq('user_id', adminId)
        .maybeSingle(),
      adminDb.from('profiles')
        .select('id, status, account_status, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_updated_at')
        .eq('id', adminId)
        .maybeSingle(),
    ]);

    if (grantError || profileError) {
      console.error('[SUPPORT_EMERGENCY_ACTIVATE] Eligibility lookup failed:', grantError?.code || profileError?.code || 'unknown');
      return NextResponse.json({ success: false, error: 'Emergency-mode eligibility could not be verified.' }, { status: 503 });
    }
    if (!grant || grant.is_enabled !== true) {
      return NextResponse.json({ success: false, error: 'Support-admin access is not enabled.' }, { status: 403 });
    }
    if (!profile || !isActiveAdminProfile(profile)) {
      return NextResponse.json({ success: false, error: 'This support-admin account is disabled or restricted.' }, { status: 403 });
    }
    if (!Number.isInteger(grant.emergency_uses_remaining) || grant.emergency_uses_remaining < 1) {
      return NextResponse.json({ success: false, error: 'No emergency-mode uses remain. Ask an administrator to grant another use.' }, { status: 409 });
    }

    // Do not allow a full administrator to bypass the full-admin session path
    // by using a support-admin grant.
    const { data: adminRows, error: adminVerificationError } = await adminDb.rpc(
      'verify_admin_login',
      { user_uuid: adminId }
    );
    if (adminVerificationError) {
      console.error('[SUPPORT_EMERGENCY_ACTIVATE] Canonical admin lookup failed:', adminVerificationError.code || 'unknown');
      return NextResponse.json({ success: false, error: 'Administrator role could not be verified.' }, { status: 503 });
    }
    const adminVerification = Array.isArray(adminRows) ? adminRows[0] : null;
    if (adminVerification?.is_valid === true) {
      return NextResponse.json({ success: false, error: 'Full administrators must use the full-admin authentication flow.' }, { status: 403 });
    }

    const twoFactorEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled);
    if (!twoFactorEnabled) {
      return NextResponse.json({ success: false, error: 'Enable administrator two-factor authentication before using emergency mode.' }, { status: 403 });
    }

    let encryptedSecret = '';
    try {
      encryptedSecret = await ensureAdminTOTPSecretEncrypted(adminDb, adminId, profile);
    } catch {
      return NextResponse.json({ success: false, error: 'Administrator authenticator could not be securely encrypted and verified.' }, { status: 503 });
    }
    if (!encryptedSecret) {
      return NextResponse.json({ success: false, error: 'Administrator authenticator is unavailable.' }, { status: 503 });
    }

    let rateLimit;
    try {
      rateLimit = await checkAdmin2FARateLimit(adminId);
    } catch {
      return NextResponse.json({ success: false, error: 'Administrator 2FA protection is temporarily unavailable.' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      const auditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'SUPPORT_EMERGENCY_2FA_RATE_LIMITED',
        details: { retryAfterSeconds: rateLimit.retryAfterSeconds },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) {
        return NextResponse.json({ success: false, error: 'Rate-limited emergency activation could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json({
        success: false,
        error: `Too many failed 2FA attempts. Try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minutes.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      }, { status: 429 });
    }

    if (!verifyAdminTOTPToken(encryptedSecret, code)) {
      const auditSaved = await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'SUPPORT_EMERGENCY_2FA_FAILED',
        details: { outcome: 'denied', reason: 'invalid_totp', remainingAttempts: rateLimit.remainingAttempts },
        ipAddress: 'server-observed',
      });
      if (!auditSaved) {
        return NextResponse.json({ success: false, error: 'Authentication failure could not be securely audited.' }, { status: 503 });
      }
      return NextResponse.json({ success: false, error: 'The authenticator code is invalid or expired.', remainingAttempts: rateLimit.remainingAttempts }, { status: 401 });
    }

    // Clear the reserved attempt only after a valid credential, and before
    // consuming the single-use emergency allowance.
    try {
      await resetAdmin2FAFailures(adminId);
    } catch {
      return NextResponse.json({ success: false, error: 'Administrator 2FA protection could not be reset. Emergency mode was not activated.' }, { status: 503 });
    }

    const verifiedAt = new Date().toISOString();
    const securityVersion = profile.admin_2fa_recovery_updated_at || adminId;
    let sessionToken: string;
    try {
      sessionToken = createAdmin2FASessionToken(adminId, securityVersion);
    } catch {
      return NextResponse.json({ success: false, error: 'Secure administrator session signing is unavailable.' }, { status: 503 });
    }

    const { data, error } = await adminDb.rpc('activate_support_admin_emergency', {
      p_support_admin_id: adminId,
      p_two_factor_verified_at: verifiedAt,
    });

    if (error || !data || data.success !== true ||
        typeof data.session_id !== 'string' ||
        typeof data.expires_at !== 'string' ||
        !Number.isInteger(data.uses_remaining)) {
      console.error('[SUPPORT_EMERGENCY_ACTIVATE] Activation RPC rejected:', error?.code || 'invalid_rpc_response');
      const status = error?.code === '42883' || error?.code === 'PGRST202' ? 503 : 409;
      return NextResponse.json({
        success: false,
        error: status === 503
          ? 'Emergency-mode database support is not installed. Contact the full administrator.'
          : 'Emergency mode could not be activated. Check remaining uses and active sessions.',
      }, { status });
    }

    const response = NextResponse.json({
      success: true,
      active: true,
      expiresAt: data.expires_at,
      usesRemaining: data.uses_remaining,
      message: 'Emergency mode is active for up to three hours.',
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    setAdmin2FACookie(response, sessionToken);
    return response;
  } catch (error: unknown) {
    console.error('[SUPPORT_EMERGENCY_ACTIVATE] Unexpected failure:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ success: false, error: 'Emergency mode could not be activated.' }, { status: 500 });
  }
}
