import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import {
  hashRecoveryPassword,
  verifyRecoveryPasswordHash,
  generateRecoveryPassword,
  logAdminSecurityAudit,
} from '@/lib/admin-security';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { require2FA: false });
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { recoveryPassword } = await req.json();
    if (!recoveryPassword || typeof recoveryPassword !== 'string') {
      return NextResponse.json({ error: 'Recovery password is required' }, { status: 400 });
    }

    const adminId = auth.user.id;
    const adminEmail = auth.user.email || 'admin';
    const adminDb = createAdminClient();

    const { data: profile } = await adminDb
      .from('profiles')
      .select('id, admin_2fa_recovery_hash')
      .eq('id', adminId)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Administrator security profile not found' }, { status: 403 });
    }

    if (!profile.admin_2fa_recovery_hash) {
      return NextResponse.json({ error: 'No 2FA recovery password exists for this account' }, { status: 400 });
    }

    const isValid = verifyRecoveryPasswordHash(recoveryPassword, profile.admin_2fa_recovery_hash);
    if (!isValid) {
      const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
      await logAdminSecurityAudit({
        adminId,
        adminEmail,
        action: 'ADMIN_2FA_RECOVERY_FAILED',
        details: { reason: 'Recovery password mismatch' },
        ipAddress: clientIp,
      });

      return NextResponse.json({ error: 'Invalid 2FA recovery password' }, { status: 400 });
    }

    // Recovery Password verified! Reset 2FA and issue fresh recovery password
    const newRawPassword = generateRecoveryPassword();
    const newHash = hashRecoveryPassword(newRawPassword);
    const nowIso = new Date().toISOString();

    await adminDb
      .from('profiles')
      .update({
        admin_2fa_enabled: false,
        is_2fa_enabled: false,
        is_mfa_enabled: false,
        admin_2fa_secret: null,
        two_factor_secret: null,
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

    return NextResponse.json({
      success: true,
      message: '2FA emergency recovery successful. Authenticator 2FA has been disabled and a new recovery password generated.',
      newRecoveryPassword: newRawPassword,
    });
  } catch (error: any) {
    console.error('2FA Recover Error:', error);
    return NextResponse.json({ error: error.message || 'Recovery failed' }, { status: 500 });
  }
}
