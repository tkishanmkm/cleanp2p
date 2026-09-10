import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import speakeasy from 'speakeasy';

export async function POST(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { asset, destinationAddress, amount, totpCode } = await req.json();

    if (!asset || !destinationAddress || !amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid withdrawal payload' }, { status: 400 });
    }

    // 1. Conditional 2FA Verification Check - Only required if user enabled it in Settings
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(profile?.is_2fa_enabled || profile?.is_mfa_enabled);
    const secret = profile?.two_factor_secret || profile?.security_answer_hash;

    if (is2faActive && secret) {
      if (!totpCode) {
        return NextResponse.json(
          { error: 'Two-Factor Authentication (2FA) code required' }, 
          { status: 403 }
        );
      }

      const isValidTotp = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: totpCode.trim(),
        window: 2,
      });

      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid 2FA authentication code' }, { status: 401 });
      }
    }

    // 2. Queue Withdrawal Record & Reserve Balance
    const { data, error } = await supabase.rpc('process_external_withdrawal', {
      p_user_id: user.id,
      p_asset: asset,
      p_destination: destinationAddress,
      p_amount: amount,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, withdrawal: data }, { status: 200 });
  } catch (err: any) {
    console.error('Withdrawal route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
