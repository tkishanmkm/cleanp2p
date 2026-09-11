import { NextResponse } from 'next/server';
import { verify2FAOTP } from '@/lib/2fa';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token, code, totpCode } = await req.json();
    const rawToken = token || code || totpCode;

    if (!rawToken) {
      return NextResponse.json({ error: 'Current OTP code is required to disable 2FA' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('two_factor_secret, is_2fa_enabled, is_mfa_enabled')
      .eq('id', user.id)
      .single();

    const is2FAEnabled = Boolean(profile?.is_2fa_enabled || profile?.is_mfa_enabled);

    if (!is2FAEnabled || !profile?.two_factor_secret) {
      return NextResponse.json({ error: '2FA is not currently enabled' }, { status: 400 });
    }

    const cleanToken = rawToken.toString().replace(/\s+/g, '').trim();

    const isVerified = verify2FAOTP(profile.two_factor_secret, cleanToken, true);

    if (!isVerified) {
      return NextResponse.json({ error: 'Invalid authenticator code' }, { status: 400 });
    }

    // Disable 2FA
    await adminClient
      .from('profiles')
      .update({
        is_2fa_enabled: false,
        is_mfa_enabled: false,
        two_factor_secret: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication has been disabled',
    });
  } catch (err: any) {
    console.error('Error disabling 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to disable 2FA' }, { status: 500 });
  }
}
