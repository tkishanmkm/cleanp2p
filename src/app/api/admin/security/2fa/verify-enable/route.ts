import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import {
  verifyAdminTOTPToken,
  generateRecoveryPassword,
  hashRecoveryPassword,
  encryptAdminTOTPSecret,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { createAdmin2FASessionToken, setAdmin2FACookie } from '@/lib/admin-2fa-session';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { code } = await req.json();
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'Verification code is required' }, { status: 400 });
    }

    const adminId = auth.user.id;
    const adminEmail = auth.user.email || 'admin';
    const adminDb = createAdminClient();

    const { data: profile } = await adminDb
      .from('profiles')
      .select('id, admin_2fa_secret, two_factor_secret')
      .eq('id', adminId)
      .single();

    const secret = profile.admin_2fa_secret || profile.two_factor_secret;
    if (!secret) {
      return NextResponse.json({ error: 'No 2FA enrollment pending. Please start 2FA setup first.' }, { status: 400 });
    }

    const isValid = verifyAdminTOTPToken(secret, code);
    if (!isValid) {
      const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
      await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_VERIFICATION_FAILED',
        details: { reason: 'Invalid TOTP code during enablement' },
        ipAddress: clientIp,
      });

      return NextResponse.json({ error: 'Invalid 6-digit authenticator code' }, { status: 400 });
    }

    // Code is valid! Generate Recovery Password and enable 2FA
    const rawRecoveryPassword = generateRecoveryPassword();
    const recoveryHash = hashRecoveryPassword(rawRecoveryPassword);
    const nowIso = new Date().toISOString();
    const encryptedSecret = encryptAdminTOTPSecret(secret);

    await adminDb
      .from('profiles')
      .update({
        admin_2fa_enabled: true,
        is_2fa_enabled: true,
        is_mfa_enabled: true,
        admin_2fa_secret: encryptedSecret,
        two_factor_secret: encryptedSecret,
        admin_2fa_recovery_hash: recoveryHash,
        admin_2fa_recovery_updated_at: nowIso,
      })
      .eq('id', adminId);

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_ENABLED',
      details: {
        recovery_password_generated: true,
        timestamp: nowIso,
      },
      ipAddress: clientIp,
    });

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
