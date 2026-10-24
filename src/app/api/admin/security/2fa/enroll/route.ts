import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import speakeasy from 'speakeasy';
import { logAdminSecurityAudit, encryptAdminTOTPSecret } from '@/lib/admin-security';

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized || !auth.user) {
      return auth.response || NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const adminId = auth.user.id;
    const adminEmail = auth.user.email || 'admin';

    // Verify admin status
    const adminDb = createAdminClient();
    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Paxones Admin (${adminEmail})`,
      issuer: 'Paxones Exchange',
    });

    const otpauthUrl = secret.otpauth_url || '';
    const encryptedSecret = encryptAdminTOTPSecret(secret.base32);

    // Save AES-256-GCM encrypted secret to admin_2fa_secret (pending confirmation)
    await adminDb
      .from('profiles')
      .update({
        admin_2fa_secret: encryptedSecret,
      })
      .eq('id', adminId);

    const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_ENROLLMENT_STARTED',
      details: { base32_preview: secret.base32.substring(0, 4) + '****' },
      ipAddress: clientIp,
    });

    return NextResponse.json({
      success: true,
      secret: secret.base32,
      otpauthUrl,
    });
  } catch (error: any) {
    console.error('2FA Enrollment Error:', error);
    return NextResponse.json({ error: error.message || 'Enrollment failed' }, { status: 500 });
  }
}
