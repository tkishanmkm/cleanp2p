import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { verify2FAOTP } from '@/lib/2fa';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User (Seller)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized request' },
        { status: 401 }
      );
    }

    // 2. Parse Payload
    const body = await request.json().catch(() => ({}));
    const tradeId = body.tradeId || body.trade_id;
    const totpCode = body.totpCode || body.totp_code || body.code;

    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Valid tradeId is required' },
        { status: 400 }
      );
    }

    // 2FA check for sensitive trade release operation
    const { data: sellerProfile } = await supabase
      .from('profiles')
      .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret, security_answer_hash')
      .eq('id', user.id)
      .maybeSingle();

    const is2faActive = Boolean(sellerProfile?.is_2fa_enabled || sellerProfile?.is_mfa_enabled);
    const secret = sellerProfile?.two_factor_secret || sellerProfile?.security_answer_hash;

    if (is2faActive) {
      if (!totpCode) {
        return NextResponse.json(
          { success: false, error: 'TWO_FACTOR_REQUIRED: 2FA TOTP code is required to release trade escrow.' },
          { status: 403 }
        );
      }
      const isValid = verify2FAOTP(secret, String(totpCode).trim(), is2faActive);
      if (!isValid) {
        return NextResponse.json({ success: false, error: 'Invalid 2FA authentication code.' }, { status: 401 });
      }
    }

    // 3. Execute Atomic RPC Procedure (Releases Escrow to Buyer & Completes Trade)
    const { data, error } = await supabase.rpc('complete_p2p_trade', {
      p_trade_id: tradeId,
      p_seller_id: user.id,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    // 4. Return Success Response
    return NextResponse.json({
      success: true,
      tradeId: data?.trade_id || tradeId,
      message: 'Escrow released successfully and buyer wallet credited.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
