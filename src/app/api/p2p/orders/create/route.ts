import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: NextRequest) {
  try {
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

    const { adId, cryptoAmount, fiatAmount } = await req.json();

    if (!adId || !cryptoAmount || !fiatAmount || Number(cryptoAmount) <= 0) {
      return NextResponse.json({ error: 'Invalid order parameters' }, { status: 400 });
    }

    // Check ad requirements safely
    const isIdUUID = isValidUUID(adId);
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},public_id.eq.${adId},id.eq.${adId}`);
    }
    const { data: ad } = await p2pQuery.maybeSingle();

    if (ad) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      const hasFullName = Boolean(
        profile?.full_name?.trim() ||
        profile?.display_name?.trim() ||
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim()
      );
      const isKycVerified = Boolean(
        profile?.is_verified ||
        profile?.kyc_status === 'approved' ||
        profile?.kyc_status === 'verified'
      );

      if (ad.require_full_name_verified && !hasFullName) {
        return NextResponse.json(
          { error: 'This trade requires you to have a verified full legal name on your profile.' },
          { status: 403 }
        );
      }

      if (ad.require_verified_users && !isKycVerified) {
        return NextResponse.json(
          { error: 'This trade requires completed identity (KYC) verification.' },
          { status: 403 }
        );
      }
    }

    // Call atomic initiate_p2p_trade RPC
    const { data, error } = await supabase.rpc('initiate_p2p_trade', {
      p_ad_id: adId,
      p_buyer_id: user.id,
      p_crypto_amount: Number(cryptoAmount),
      p_fiat_amount: Number(fiatAmount),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const tradeId = typeof data === 'string' ? data : (data?.trade_id || data?.id || data);
    return NextResponse.json({ success: true, tradeId, data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
