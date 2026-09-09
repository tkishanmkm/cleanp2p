import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'Current OTP code is required to disable 2FA' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: profile } = await adminClient
      .from('profiles')
      .select('two_factor_secret, is_2fa_enabled')
      .eq('id', user.id)
      .single();

    if (!profile?.two_factor_secret) {
      return NextResponse.json({ error: '2FA is not currently enabled' }, { status: 400 });
    }

    const cleanToken = token.toString().replace(/\s+/g, '').trim();

    const isVerified = speakeasy.totp.verify({
      secret: profile.two_factor_secret,
      encoding: 'base32',
      token: cleanToken,
      window: 2,
    });

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
