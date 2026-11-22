import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import speakeasy from 'speakeasy';
import { logAdminSecurityAudit, encryptAdminTOTPSecret } from '@/lib/admin-security';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { isActiveAdminProfile } from '@/lib/admin-2fa-request';

export async function POST(req: NextRequest) {
  try {
    const adminAuth = await verifyServerAdmin(req);
    if (!adminAuth.authorized) return adminAuth.response!;

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminId = user.id;
    const adminEmail = user.email || 'admin';

    // Verify admin status
    const adminDb = createAdminClient();
    const { data: profile, error: profileError } = await adminDb
      .from('profiles')
      .select('id, is_admin, is_admin_account, role, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status, admin_2fa_enabled, is_2fa_enabled')
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
      return NextResponse.json({ error: 'Administrator 2FA is already enabled. Disable it or use recovery before enrolling a replacement authenticator.' }, { status: 409 });
    }

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Wayones Admin (${adminEmail})`,
      issuer: 'Wayones Exchange',
    });

    const otpauthUrl = secret.otpauth_url || '';
    const encryptedSecret = encryptAdminTOTPSecret(secret.base32);

    // Save AES-256-GCM encrypted secret to admin_2fa_secret (pending confirmation)
    const { data: savedSecretRows, error: saveSecretError } = await adminDb
      .from('profiles')
      .update({
        admin_2fa_secret: encryptedSecret,
      })
      .eq('id', adminId)
      .select('id');

    if (saveSecretError || !Array.isArray(savedSecretRows) || savedSecretRows.length !== 1) {
      console.error('Failed to save pending admin 2FA secret:', saveSecretError?.code || null);
      return NextResponse.json({ error: 'Failed to save 2FA enrollment. Please try again.' }, { status: 500 });
    }

    const auditSaved = await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: 'ADMIN_2FA_ENROLLMENT_STARTED',
      details: { secret_generated: true },
      ipAddress: 'server-observed',
    });
    if (!auditSaved) {
      return NextResponse.json({ error: '2FA enrollment could not be securely audited. Please contact support.' }, { status: 503 });
    }

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
