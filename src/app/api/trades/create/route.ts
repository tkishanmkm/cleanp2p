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
    const {
      ad_id,
      fiat_amount,
      crypto_amount,
      payment_method,
      price,
      fiat_currency,
      trade_ref,
      idempotency_key,
    } = body;

    const idempotencyKey =
      idempotency_key ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      null;

    if (!ad_id) {
      return NextResponse.json({ error: 'Advertisement ID is required.' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(ad_id);

    // 1. Fetch Ad safely to read metadata & parameters
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${ad_id},public_ad_id.eq.${ad_id}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${ad_id},public_id.eq.${ad_id},id.eq.${ad_id}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', ad_id).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_id.eq.${ad_id},public_ad_id.eq.${ad_id}`).maybeSingle();
        if (primaryAd) ad = primaryAd;
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

    // 3. Resolve numerical values and authoritative parameters
    const unitPrice = Number(price ?? ad.fixed_rate ?? ad.price ?? 1);
    let calculatedCrypto = parseFloat(crypto_amount);
    let numericFiat = parseFloat(fiat_amount);

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      if (!isNaN(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    // Exact fiat amount invariant: fiat_amount = ROUND(crypto_amount * price, 2)
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));

    // 4. Verify min/max limits
    const minLimit = Number(ad.min_amount ?? ad.min_limit ?? 0);
    const maxLimit = Number(ad.max_amount ?? ad.max_limit ?? Infinity);
    if (numericFiat < minLimit || numericFiat > maxLimit) {
      return NextResponse.json(
        { error: `Amount must be between ${minLimit} and ${maxLimit} ${ad.fiat_currency || ad.fiat || 'USD'}` },
        { status: 400 }
      );
    }

    // 5. Verify Trader Requirements (Full name & KYC)
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

    // 6. Enforce $1,000 USD Cumulative Limit for Unverified Accounts
    if (!isKycVerified) {
      const userFiatCurrency = (ad.fiat_currency || ad.fiat || 'USD').toUpperCase();
      let fiatToUsdRate = 1.0;
      if (userFiatCurrency === 'INR') fiatToUsdRate = 1 / 85.0;
      else if (userFiatCurrency === 'EUR') fiatToUsdRate = 1.08;
      else if (userFiatCurrency === 'GBP') fiatToUsdRate = 1.28;
      else if (userFiatCurrency === 'CAD' || userFiatCurrency === 'AUD') fiatToUsdRate = 0.68;
      else if (userFiatCurrency === 'AED') fiatToUsdRate = 0.27;

      const currentTradeUsd = numericFiat * fiatToUsdRate;

      const { data: pastTrades } = await supabase
        .from('trades')
        .select('fiat_amount, fiat_currency, status')
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .in('status', ['COMPLETED', 'completed', 'PAID', 'paid', 'ESCROW_LOCKED', 'in_escrow', 'DISPUTED']);

      let priorTradedUsd = 0;
      if (pastTrades && pastTrades.length > 0) {
        for (const t of pastTrades) {
          const curr = (t.fiat_currency || 'USD').toUpperCase();
          let rate = 1.0;
          if (curr === 'INR') rate = 1 / 85.0;
          else if (curr === 'EUR') rate = 1.08;
          else if (curr === 'GBP') rate = 1.28;
          else if (curr === 'CAD' || curr === 'AUD') rate = 0.68;
          else if (curr === 'AED') rate = 0.27;
          priorTradedUsd += (Number(t.fiat_amount) || 0) * rate;
        }
      }

      if (priorTradedUsd + currentTradeUsd > 1000) {
        return NextResponse.json(
          {
            error: `Unverified accounts have a cumulative limit of $1,000 USD in total trades (Current history: $${priorTradedUsd.toFixed(2)} USD). Please complete Identity Verification in Settings to trade without limits.`,
          },
          { status: 403 }
        );
      }
    }

    // 7. Resolve Payment Method & Currency
    const paymentMethods = Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : typeof ad.payment_methods === 'string'
      ? JSON.parse(ad.payment_methods)
      : ['Bank Transfer'];
    const resolvedPaymentMethod = payment_method || paymentMethods[0] || 'Bank Transfer';
    const resolvedFiatCurrency = fiat_currency || ad.fiat_currency || ad.fiat || 'USD';
    const shortRef = trade_ref || generateTradeId();
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || ad_id);

    // 8. Execute Atomic Escrow Lock & Trade Creation via Canonical Database RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: shortRef,
      p_idempotency_key: idempotencyKey,
    });

    if (rpcError) {
      console.error('[Trade Creation] initiate_trade_with_escrow RPC error:', rpcError);
      return NextResponse.json(
        { error: rpcError.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    if (!rpcResult || rpcResult.success === false) {
      return NextResponse.json(
        { error: rpcResult?.message || 'Failed to initiate trade with escrow.' },
        { status: 400 }
      );
    }

    const tradeId = rpcResult.trade_id;
    const publicId = rpcResult.public_id || shortRef;
    const sellerId = rpcResult.seller_id;
    const buyerId = rpcResult.buyer_id;
    const nowIso = new Date().toISOString();

    // 9. Send Auto-Reply Message if configured
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
          trade_id: tradeId,
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

    // 10. Send Activity Center & Trade Request Notifications
    try {
      const formattedCoin = (rpcResult.asset || ad.crypto || 'USDT').toUpperCase();
      if (sellerId) {
        await supabase.from('notifications').insert({
          user_id: sellerId,
          title: 'Trade Request Initiated',
          message: `New trade request #${publicId} opened: ${calculatedCrypto.toFixed(4)} ${formattedCoin} for ${numericFiat.toFixed(2)} ${resolvedFiatCurrency}.`,
          link: `/trade/${tradeId}`,
          is_read: false,
          created_at: nowIso,
        });
      }
      if (buyerId && buyerId !== sellerId) {
        await supabase.from('notifications').insert({
          user_id: buyerId,
          title: 'Trade Request Initiated',
          message: `Trade #${publicId} opened successfully. Awaiting payment/escrow confirmation.`,
          link: `/trade/${tradeId}`,
          is_read: false,
          created_at: nowIso,
        });
      }
    } catch (notifErr) {
      console.warn('Trade notification creation notice:', notifErr);
    }

    return NextResponse.json({
      success: true,
      trade_id: tradeId,
      id: tradeId,
      public_id: publicId,
      trade: rpcResult,
    });
  } catch (err: any) {
    console.error('Error creating trade:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to initiate trade.' },
      { status: 500 }
    );
  }
}
