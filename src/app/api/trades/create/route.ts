import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { generateTradeId } from '@/lib/id-generator';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Please sign in to initiate a trade.' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { ad_id, fiat_amount, crypto_amount } = body;

    if (!ad_id) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const numericFiat = parseFloat(fiat_amount);
    if (isNaN(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Invalid fiat amount.' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(ad_id);

    // 1. Fetch Ad safely from p2p_ads or ads
    let ad: any = null;
    let validAdUuid: string | null = null;

    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${ad_id},public_ad_id.eq.${ad_id}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${ad_id},public_id.eq.${ad_id},id.eq.${ad_id}`);
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
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', ad_id).maybeSingle();
        if (primaryAd) {
          ad = primaryAd;
          validAdUuid = primaryAd.id;
        }
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_id.eq.${ad_id},public_ad_id.eq.${ad_id}`).maybeSingle();
        if (primaryAd && isValidUUID(primaryAd.id)) {
          ad = primaryAd;
          validAdUuid = primaryAd.id;
        }
      }
    }

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // 2. Prevent trading with own ad
    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    // 3. Verify min/max limits
    const minLimit = Number(ad.min_amount ?? ad.min_limit ?? 0);
    const maxLimit = Number(ad.max_amount ?? ad.max_limit ?? Infinity);
    if (numericFiat < minLimit || numericFiat > maxLimit) {
      return NextResponse.json(
        { error: `Amount must be between ${minLimit} and ${maxLimit} ${ad.fiat_currency || 'USD'}` },
        { status: 400 }
      );
    }

    // 3.5. Verify Trader Requirements (Full name & KYC)
    const { data: buyerProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    const hasFullName = Boolean(
      buyerProfile?.full_name?.trim() ||
      buyerProfile?.display_name?.trim() ||
      user.user_metadata?.full_name?.trim() ||
      user.user_metadata?.name?.trim()
    );
    const isKycVerified = Boolean(
      buyerProfile?.is_verified ||
      buyerProfile?.kyc_status === 'approved' ||
      buyerProfile?.kyc_status === 'verified'
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

    const isSellAd = (ad.type || ad.ad_type || 'SELL').toUpperCase() === 'SELL';
    const adOwnerId = ad.user_id || ad.seller_id || ad.advertiser_id || (ad.profiles && ad.profiles.id);
    const buyerId = isSellAd ? user.id : adOwnerId;
    const sellerId = isSellAd ? adOwnerId : user.id;

    const unitPrice = Number(ad.fixed_rate ?? ad.price ?? 1);
    const calculatedCrypto = parseFloat(crypto_amount) || (unitPrice > 0 ? numericFiat / unitPrice : 0);

    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const paymentMethod = paymentMethods[0] || 'Bank Transfer';

    const shortId = generateTradeId();

    // 4. Insert Trade into database safely
    let tradeResult: any = null;

    const tradePayload: Record<string, any> = {
      trade_id: shortId,
      public_id: shortId,
      buyer_id: buyerId,
      seller_id: sellerId,
      crypto: ad.crypto || ad.asset || 'BTC',
      amount: calculatedCrypto,
      fiat_currency: ad.fiat_currency || ad.fiat || 'USD',
      fiat_amount: numericFiat,
      amount_usd: numericFiat,
      price: unitPrice,
      payment_method: paymentMethod,
      status: 'pending',
    };

    if (validAdUuid) {
      tradePayload.ad_id = validAdUuid;
    }

    // Full schema attempt
    const { data: insertedTrade, error: insertError } = await supabase
      .from('trades')
      .insert(tradePayload)
      .select('*')
      .single();

    if (insertError) {
      console.warn('Full trade insertion failed, trying safe fallback:', insertError);
      // Clean fallback without ad_id to prevent fkey or uuid errors
      const { data: fallbackTrade, error: fallbackError } = await supabase
        .from('trades')
        .insert({
          trade_id: shortId,
          buyer_id: buyerId,
          seller_id: sellerId,
          crypto_amount: calculatedCrypto,
          amount: calculatedCrypto,
          fiat_amount: numericFiat,
          price: unitPrice,
          status: 'pending',
        })
        .select('*')
        .single();

      if (fallbackError) {
        // Minimal fallback
        const { data: ultraMinimal, error: ultraError } = await supabase
          .from('trades')
          .insert({
            buyer_id: buyerId,
            seller_id: sellerId,
            amount_usd: numericFiat,
            status: 'pending',
          })
          .select('*')
          .single();

        if (ultraError) throw ultraError;
        tradeResult = ultraMinimal;
      } else {
        tradeResult = fallbackTrade;
      }
    } else {
      tradeResult = insertedTrade;
    }

    if (!tradeResult || !tradeResult.id) {
      throw new Error('Failed to create trade record.');
    }

    const actualTradeId = tradeResult.id;
    const nowIso = new Date().toISOString();

    // 5. Send Auto-Reply Message if configured (ad auto_reply or profile auto_reply_message)
    try {
      const autoReplyText = ad.auto_reply?.trim();
      let sellerAutoReply = autoReplyText;
      let sellerUsername = 'Trader';

      const { data: sellerProf } = await supabase
        .from('profiles')
        .select('username, auto_reply_message')
        .eq('id', sellerId)
        .maybeSingle();

      if (sellerProf) {
        if (sellerProf.username) sellerUsername = sellerProf.username;
        if (!sellerAutoReply && sellerProf.auto_reply_message?.trim()) {
          sellerAutoReply = sellerProf.auto_reply_message.trim();
        }
      }

      if (sellerAutoReply && sellerAutoReply.length > 0) {
        await supabase.from('trade_messages').insert({
          trade_id: actualTradeId,
          sender_id: sellerId,
          sender_username: sellerUsername,
          message: sellerAutoReply,
          visibility: 'all',
          created_at: nowIso,
        });
      }
    } catch (autoReplyErr) {
      console.warn('Auto-reply message creation notice:', autoReplyErr);
    }

    // 6. Send Activity Center & Trade Request Notifications
    try {
      const formattedCoin = (ad.crypto || 'BTC').toUpperCase();
      // Notify Seller of Trade Request
      if (sellerId) {
        await supabase.from('notifications').insert({
          user_id: sellerId,
          title: 'Trade Request Initiated',
          message: `New trade request #${shortId} opened: ${calculatedCrypto.toFixed(4)} ${formattedCoin} for ${numericFiat.toFixed(2)} ${ad.fiat_currency || 'USD'}.`,
          link: `/trade/${actualTradeId}`,
          is_read: false,
          created_at: nowIso,
        });
      }
      // Notify Buyer
      if (buyerId && buyerId !== sellerId) {
        await supabase.from('notifications').insert({
          user_id: buyerId,
          title: 'Trade Request Initiated',
          message: `Trade #${shortId} opened successfully. Awaiting payment/escrow confirmation.`,
          link: `/trade/${actualTradeId}`,
          is_read: false,
          created_at: nowIso,
        });
      }
    } catch (notifErr) {
      console.warn('Trade notification creation notice:', notifErr);
    }

    return NextResponse.json({
      success: true,
      trade_id: tradeResult.id,
      id: tradeResult.id,
      trade: tradeResult,
    });
  } catch (err: any) {
    console.error('Error creating trade:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to initiate trade.' },
      { status: 500 }
    );
  }
}
