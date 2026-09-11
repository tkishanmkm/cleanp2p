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

    const { secret, token, code } = await req.json();
    const rawToken = token || code;

    if (!secret || !rawToken) {
      return NextResponse.json({ error: 'Secret and 6-digit OTP token are required' }, { status: 400 });
    }

    const cleanSecret = secret.toString().trim();
    const cleanToken = rawToken.toString().replace(/\s+/g, '').trim();

    if (cleanToken.length < 4 || cleanToken.length > 8) {
      return NextResponse.json({ error: 'Please enter a valid 6-digit OTP code' }, { status: 400 });
    }

    // Verify TOTP with tolerance for minor time drift
    const isVerified = speakeasy.totp.verify({
      secret: cleanSecret,
      encoding: 'base32',
      token: cleanToken,
      window: 4, // ±120s tolerance for mobile clock discrepancies
    });

    if (!isVerified) {
      return NextResponse.json({
        error: 'Invalid authenticator code. Please check that the code in your authenticator app is current and try again.'
      }, { status: 400 });
    }

    // Enable 2FA on profile with admin client
    const adminClient = getSupabaseAdminClient();
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({
        is_2fa_enabled: true,
        is_mfa_enabled: true,
        two_factor_secret: cleanSecret,
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
