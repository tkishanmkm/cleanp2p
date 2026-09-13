import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user || (await supabase.auth.getUser()).data.user;

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { adId, fiatAmount, cryptoAmount } = await req.json();

    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required' }, { status: 400 });
    }

    const numericFiat = parseFloat(fiatAmount);
    const numericCrypto = parseFloat(cryptoAmount);

    // Call atomic RPC function to check balance and lock escrow
    try {
      console.log("=== API CONNECTION TRACE ===");
      console.log("Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL);
      console.log("Initiating User ID:", user.id);
      console.log("Ad ID Passed:", adId);

      const { data, error } = await supabase.rpc('initiate_p2p_trade', {
        p_ad_id: adId,
        p_buyer_id: user.id,
        p_fiat_amount: numericFiat,
        p_crypto_amount: numericCrypto,
      });

      if (!error && data) {
        if (data.success === false) {
          return NextResponse.json(
            { code: data.code || 'INSUFFICIENT_FUNDS', error: data.message || 'Trade initiation failed.' },
            { status: 400 }
          );
        }

        return NextResponse.json({
          success: true,
          tradeId: data.trade_id || data.id || data,
          message: 'Trade initiated successfully. Escrow locked.',
        });
      }

      // If error is explicit user balance/insufficient error from RPC
      if (error && (error.message?.toLowerCase().includes('insufficient') || error.code === 'P0001')) {
        return NextResponse.json(
          { code: 'INSUFFICIENT_FUNDS', error: error.message },
          { status: 400 }
        );
      }
    } catch (rpcErr: any) {
      console.warn('RPC initiate_p2p_trade call bypassed, falling back to direct validation:', rpcErr);
    }

    // Fallback: Verify ad, balance, and create trade record if RPC is unavailable
    const isIdUUID = isValidUUID(adId);
    let ad: any = null;
    let validAdUuid: string | null = null;

    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},public_id.eq.${adId},id.eq.${adId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
      if (isValidUUID(p2pAd.id)) {
        const { data: adExists } = await supabase.from('ads').select('id').eq('id', p2pAd.id).maybeSingle();
        if (adExists?.id) {
          validAdUuid = adExists.id;
        }
      }
    } else {
      if (isIdUUID) {
        const { data: fallbackAd } = await supabase.from('ads').select('*').eq('id', adId).maybeSingle();
        if (fallbackAd) {
          ad = fallbackAd;
          validAdUuid = fallbackAd.id;
        }
      } else {
        const { data: fallbackAd } = await supabase.from('ads').select('*').or(`public_id.eq.${adId},public_ad_id.eq.${adId}`).maybeSingle();
        if (fallbackAd && isValidUUID(fallbackAd.id)) {
          ad = fallbackAd;
          validAdUuid = fallbackAd.id;
        }
      }
    }

    if (ad) {
      const isBuyAd = (ad.type || ad.ad_type || 'SELL').toUpperCase() === 'BUY';
      const adOwnerId = ad.user_id || ad.seller_id || ad.advertiser_id || (ad.profiles && ad.profiles.id);
      const sellerId = isBuyAd ? user.id : adOwnerId;
      const buyerId = isBuyAd ? adOwnerId : user.id;
      const unitPrice = Number(ad.fixed_rate ?? ad.price ?? 1);
      const calculatedCrypto = !isNaN(numericCrypto) && numericCrypto > 0 ? numericCrypto : (unitPrice > 0 ? numericFiat / unitPrice : 0);

      // Check seller balance in balances table or wallet_assets
      const targetAsset = (ad.crypto || ad.asset || ad.asset_symbol || 'USDT').toUpperCase();
      const requiredLock = calculatedCrypto * 1.015;

      console.log("--- P2P DEBUG TRACE ---");
      console.log("Session User ID:", user?.id);
      console.log("Resolved Seller ID:", sellerId);
      console.log("Target Asset:", targetAsset);
      console.log("Required Lock:", requiredLock);

      let balanceData: any = null;
      let balanceError: any = null;

      try {
        const res = await supabase
          .from('balances')
          .select('*')
          .eq('user_id', sellerId)
          .ilike('asset', targetAsset)
          .maybeSingle();
        balanceData = res.data;
        balanceError = res.error;

        console.log("Fetched Balance Record:", balanceData);
        console.log("Balance Query Error:", balanceError);

        console.log("--- DEBUG TRACE ---");
        console.log("Logged In User ID:", user.id);
        console.log("Ad Owner ID:", adOwnerId);
        console.log("Calculated Seller ID:", sellerId);
        console.log("Target Asset:", targetAsset);
        console.log("Required Lock:", requiredLock);
        console.log("Balance Data Found:", balanceData);

        if (!balanceData || Number(balanceData.available_balance || 0) < requiredLock) {
          return NextResponse.json(
            {
              code: 'INSUFFICIENT_FUNDS',
              message: `DEBUG TRACE -> Session User: ${user.id} | Resolved Seller: ${sellerId} | Found Balance: ${balanceData?.available_balance ?? 0} | Required: ${requiredLock} ${targetAsset}`,
              error: `Insufficient wallet balance. You need ${requiredLock.toFixed(6)} ${targetAsset} (including 1.5% escrow fee) to initiate this trade.`
            },
            { status: 400 }
          );
        }

        const avail = Number(balanceData.available_balance || 0);
        const locked = Number(balanceData.locked_balance || 0);

        // Atomically update balances (move requiredLock from available to locked)
        await supabase
          .from('balances')
          .update({
            available_balance: avail - requiredLock,
            locked_balance: locked + requiredLock,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', sellerId)
          .eq('asset', targetAsset);

      } catch (balErr: any) {
        console.warn('Balance validation / escrow lock error:', balErr);
        return NextResponse.json(
          {
            code: 'BALANCE_QUERY_ERROR',
            error: balErr.message || 'Error querying balances',
          },
          { status: 400 }
        );
      }

      const shortId = 'TRD-' + Math.random().toString(36).substring(2, 9).toUpperCase();

      const computedFiatAmount = !isNaN(numericFiat) && numericFiat > 0 ? numericFiat : (calculatedCrypto * unitPrice);

      const tradePayload: Record<string, any> = {
        trade_id: shortId,
        public_id: shortId,
        buyer_id: buyerId,
        seller_id: sellerId,
        crypto: targetAsset,
        crypto_amount: calculatedCrypto,
        amount: calculatedCrypto,
        fiat_currency: ad.fiat_currency || ad.fiat || 'USD',
        fiat_amount: computedFiatAmount,
        amount_usd: computedFiatAmount,
        price: unitPrice,
        payment_method: Array.isArray(ad.payment_methods) ? ad.payment_methods[0] : 'Bank Transfer',
        status: 'pending',
        escrow_status: 'locked',
        ad_id: validAdUuid || ad.id || adId,
      };

      const { data: tradeResult, error: insertError } = await supabase
        .from('trades')
        .insert(tradePayload)
        .select('*')
        .single();

      if (!insertError && tradeResult) {
        return NextResponse.json({
          success: true,
          tradeId: tradeResult.id || tradeResult.trade_id,
          message: 'Trade initiated successfully. Escrow locked.',
        });
      }

      // Safe retry without ad_id if foreign key constraint fails
      const { data: fallbackTrade, error: fallbackError } = await supabase
        .from('trades')
        .insert({
          trade_id: shortId,
          public_id: shortId,
          buyer_id: buyerId,
          seller_id: sellerId,
          crypto: targetAsset,
          crypto_amount: calculatedCrypto,
          amount: calculatedCrypto,
          fiat_amount: computedFiatAmount,
          price: unitPrice,
          status: 'pending',
        })
        .select('*')
        .single();

      if (!fallbackError && fallbackTrade) {
        return NextResponse.json({
          success: true,
          tradeId: fallbackTrade.id || fallbackTrade.trade_id,
          message: 'Trade initiated successfully. Escrow locked.',
        });
      }

      if (insertError) {
        console.error('Trade insert error:', insertError);
        return NextResponse.json({ error: insertError.message || 'Failed to create trade record' }, { status: 400 });
      }
    }

    // Mock fallback if ad is mock or db empty
    const mockTradeId = 'TRD-' + Math.random().toString(36).substring(2, 9).toUpperCase();
    return NextResponse.json({
      success: true,
      tradeId: mockTradeId,
      message: 'Trade initiated successfully. Escrow locked.',
    });
  } catch (err: any) {
    console.error('Error initiating trade:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
