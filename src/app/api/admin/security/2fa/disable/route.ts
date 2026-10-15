import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import {
  verifyAdminTOTPToken,
  verifyRecoveryPasswordHash,
  logAdminSecurityAudit,
} from '@/lib/admin-security';
import { clearAdmin2FACookie } from '@/lib/admin-2fa-session';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { require2FA: false });
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { code, recoveryPassword } = await req.json();
    if (!code && !recoveryPassword) {
      return NextResponse.json(
        { error: 'Provide either a 6-digit TOTP code or your 2FA recovery password' },
        { status: 400 }
      );
    }

    const adminId = auth.user.id;
    const adminEmail = auth.user.email || 'admin';
    const adminDb = createAdminClient();

    const { data: profile } = await adminDb
      .from('profiles')
      .select('id, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash')
      .eq('id', adminId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Administrator security profile not found' }, { status: 403 });
    }

    let isAuthValid = false;
    let authMethodUsed = '';

    const secret = profile.admin_2fa_secret || profile.two_factor_secret;
    if (code && secret) {
      isAuthValid = verifyAdminTOTPToken(secret, String(code));
      if (isAuthValid) authMethodUsed = 'totp_code';
    }

    if (!isAuthValid && recoveryPassword && profile.admin_2fa_recovery_hash) {
      isAuthValid = verifyRecoveryPasswordHash(String(recoveryPassword), profile.admin_2fa_recovery_hash);
      if (isAuthValid) authMethodUsed = 'recovery_password';
    }

    if (!isAuthValid) {
      const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
      await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_DISABLE_FAILED',
        details: { reason: 'Invalid code or recovery password' },
        ipAddress: clientIp,
      });

      return NextResponse.json(
        { error: 'Invalid authenticator code or recovery password' },
        { status: 400 }
      );
    }

    // Disable 2FA & invalidate secrets + recovery password
    await adminDb
      .from('profiles')
      .update({
        admin_2fa_enabled: false,
        is_2fa_enabled: false,
        is_mfa_enabled: false,
        admin_2fa_secret: null,
        two_factor_secret: null,
        admin_2fa_recovery_hash: null,
      })
      .eq('id', adminId);

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_DISABLED',
      details: { method_used: authMethodUsed },
      ipAddress: clientIp,
    });

    const response = NextResponse.json({
      success: true,
      message: 'Admin 2FA has been disabled.',
    });

    clearAdmin2FACookie(response);
    return response;
  } catch (error: any) {
    console.error('2FA Disable Error:', error);
    return NextResponse.json({ error: error.message || 'Disable 2FA failed' }, { status: 500 });
  }
}
