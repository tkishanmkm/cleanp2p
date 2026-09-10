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

    const { recipientUsername, asset, amount, totpCode } = await req.json();

    if (!recipientUsername || !asset || !amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload' }, { status: 400 });
    }

    // 1. Conditional 2FA Check - Only required if user enabled it in Settings
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(profile?.is_2fa_enabled || profile?.is_mfa_enabled);
    const secret = profile?.two_factor_secret || profile?.security_answer_hash;

    if (is2faActive && secret) {
      if (!totpCode) {
        return NextResponse.json({ error: '2FA code required for internal transfers' }, { status: 403 });
      }

      const isValidTotp = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: totpCode.trim(),
        window: 2,
      });

      if (!isValidTotp) {
        return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
      }
    }

    // 2. Execute Atomic DB Transfer Function directly
    const { data, error } = await supabase.rpc('execute_internal_transfer', {
      p_sender_id: user.id,
      p_recipient_username: recipientUsername,
      p_asset: asset,
      p_gross_amount: amount,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data.success) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err: any) {
    console.error('Transfer route error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
