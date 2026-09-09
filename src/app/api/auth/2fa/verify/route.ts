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

    const { secret, token } = await req.json();

    if (!secret || !token) {
      return NextResponse.json({ error: 'Secret and OTP token are required' }, { status: 400 });
    }

    // Clean token
    const cleanToken = token.toString().replace(/\s+/g, '').trim();

    const isVerified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: cleanToken,
      window: 2, // Allow ±60s clock skew
    });

    if (!isVerified) {
      return NextResponse.json({ error: 'Invalid authenticator code. Please check your app and try again.' }, { status: 400 });
    }

    // Enable 2FA on profile with admin client to bypass RLS column restrictions
    const adminClient = getSupabaseAdminClient();
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({
        is_2fa_enabled: true,
        is_mfa_enabled: true,
        two_factor_secret: secret,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating 2FA in profiles:', updateError);
      return NextResponse.json({ error: 'Failed to update 2FA status in database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Two-factor authentication successfully enabled',
    });
  } catch (err: any) {
    console.error('Error verifying 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to verify 2FA' }, { status: 500 });
  }
}
