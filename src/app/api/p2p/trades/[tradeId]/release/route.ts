import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { verify2FAOTP } from '@/lib/2fa';

export async function POST(
  req: NextRequest,
  { params }: { params: { tradeId: string } }
) {
  try {
    const { tradeId } = params;
    const body = await req.json().catch(() => ({}));
    const totpCode = body.totpCode || body.totp_code || body.code;

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminClient = getSupabaseAdminClient();

    // 2FA check for sensitive trade release operation
    const { data: sellerProfile } = await adminClient
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, two_factor_secret')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(
      sellerProfile?.is_2fa_enabled || sellerProfile?.is_mfa_enabled || sellerProfile?.two_factor_enabled
    );
    const secret = sellerProfile?.totp_secret || sellerProfile?.two_factor_secret;

    if (is2faActive) {
      if (!totpCode) {
        return NextResponse.json(
          { error: 'TWO_FACTOR_REQUIRED: 2FA TOTP code is required to release trade escrow.' },
          { status: 403 }
        );
      }
      const isValid = verify2FAOTP(secret, String(totpCode).trim(), is2faActive);
      if (!isValid) {
        return NextResponse.json({ error: 'Invalid 2FA authentication code.' }, { status: 401 });
      }
    }

    // Execute atomic escrow release procedure via service_role client
    const { data, error } = await adminClient.rpc('release_trade_escrow', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
