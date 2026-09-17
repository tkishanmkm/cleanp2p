import { NextResponse } from 'next/server';
import speakeasy from 'speakeasy';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const body = await req.json().catch(() => ({}));
    let { secret, token, code, totpCode, userId } = body;
    const rawToken = token || code || totpCode;

    const targetUserId = user?.id || userId;
    if (!targetUserId && !secret) {
      return NextResponse.json({ error: 'Unauthorized or missing user identifier' }, { status: 401 });
    }

    if (!rawToken) {
      return NextResponse.json({ error: '4-8 digit OTP verification code is required' }, { status: 400 });
    }

    const cleanToken = rawToken.toString().replace(/[\s-]+/g, '').trim();
    if (cleanToken.length < 4 || cleanToken.length > 8) {
      return NextResponse.json({ error: 'Please enter a valid 4-8 digit OTP code' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();
    let isEnablingNewSecret = false;

    // If secret is not provided in body, load from user's profile
    if (!secret && targetUserId) {
      const { data: prof } = await adminClient
        .from('profiles')
        .select('two_factor_secret, security_answer_hash, is_2fa_enabled, is_mfa_enabled')
        .eq('id', targetUserId)
        .maybeSingle();

      secret = prof?.two_factor_secret || prof?.security_answer_hash;
      if (!secret) {
        return NextResponse.json({ error: '2FA is not configured for this account' }, { status: 400 });
      }
    } else {
      isEnablingNewSecret = true;
    }

    const cleanSecret = String(secret).trim();

    // Verify TOTP with tolerance for minor time drift (±120s)
    const isVerified = speakeasy.totp.verify({
      secret: cleanSecret,
      encoding: 'base32',
      token: cleanToken,
      window: 4,
    });

    if (!isVerified) {
      return NextResponse.json({
        error: 'Invalid authenticator code. Please check that the code in your authenticator app is current and try again.'
      }, { status: 400 });
    }

    // If user provided a new secret during setup, save it to profile
    if (isEnablingNewSecret && targetUserId) {
      const { error: updateError } = await adminClient
        .from('profiles')
        .update({
          is_2fa_enabled: true,
          is_mfa_enabled: true,
          two_factor_secret: cleanSecret,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetUserId);

      if (updateError) {
        console.error('Error updating 2FA in profiles:', updateError);
        return NextResponse.json({ error: 'Failed to update 2FA status in database' }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      verified: true,
      message: isEnablingNewSecret
        ? 'Two-factor authentication successfully enabled'
        : 'Two-factor authentication verified successfully',
    });
  } catch (err: any) {
    console.error('Error verifying 2FA:', err);
    return NextResponse.json({ error: err.message || 'Failed to verify 2FA' }, { status: 500 });
  }
}
