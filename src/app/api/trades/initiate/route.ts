import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { generateTradeId } from '@/lib/id-generator';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';

export const dynamic = 'force-dynamic';

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

export async function POST(req: Request) {
  try {
    let supabase = await createClient();
    const authHeader = req.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      supabase = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
    }
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please sign in.' },
        { status: 401 }
      );
    }

    // Pending Withdrawal Approval Lockout Check
    const isWithdrawalPending = await hasPendingWithdrawalApproval(user.id);
    if (isWithdrawalPending) {
      return NextResponse.json({
        error: 'Your previous withdrawal is awaiting administrator approval. You cannot initiate new P2P trades until it is approved or rejected.',
        code: 'WITHDRAWAL_APPROVAL_PENDING',
      }, { status: 403 });
    }

    // Platform Guard Check
    try {
      await assertPlatformControlAllowed('trade', { userId: user.id });
    } catch (guardErr: any) {
      return NextResponse.json(
        { error: guardErr.message || 'Trading is temporarily disabled.', code: guardErr.code || 'PLATFORM_TRADING_DISABLED' },
        { status: guardErr.statusCode || 403 }
      );
    }

    const body = await req.json();
    const adId = body.adId || body.ad_id;
    const rawFiat = body.fiatAmount ?? body.fiat_amount;
    const rawCrypto = body.cryptoAmount ?? body.crypto_amount;
    const customPaymentMethod = body.paymentMethod || body.payment_method;
    const tradeRef = body.tradeRef || body.trade_ref || generateTradeId();
    const idempotencyKey =
      (body.idempotencyKey ||
      body.idempotency_key ||
      req.headers.get('x-idempotency-key') ||
      req.headers.get('idempotency-key') ||
      '').trim();

    if (!idempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required to initiate a trade.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      }, { status: 400 });
    }

    if (!adId) {
      return NextResponse.json({ error: 'Advertisement ID is required' }, { status: 400 });
    }

    // Replay an existing idempotent request before looking up the ad. This lets a
    // legitimate retry succeed if the advertisement was later paused or deleted.
    // The stored trade is authoritative; the key alone never authorizes access.
    const replayAdmin = getSupabaseAdminClient();
    const { data: existingTrade, error: replayLookupError } = await replayAdmin
      .from('trades')
      .select('id, public_id, buyer_id, seller_id, ad_id, public_ad_id, crypto_amount, fiat_amount, fiat_currency, price, unit_price, rate, payment_method, crypto, asset_code, status, escrow_status, idempotency_key')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (replayLookupError) {
      console.error('[trades/initiate] Idempotency lookup failed:', replayLookupError);
      return NextResponse.json(
        { success: false, code: 'IDEMPOTENCY_LOOKUP_FAILED', error: 'Unable to verify this retry safely.' },
        { status: 503 }
      );
    }

    if (existingTrade) {
      const callerIsParticipant =
        String(existingTrade.buyer_id) === user.id ||
        String(existingTrade.seller_id) === user.id;
      const requestedAd = String(adId).trim();
      const adMatches =
        String(existingTrade.ad_id ?? '') === requestedAd ||
        String(existingTrade.public_ad_id ?? '') === requestedAd;

      const retryCryptoRaw = rawCrypto == null || rawCrypto === '' ? NaN : Number(rawCrypto);
      const retryFiatRaw = rawFiat == null || rawFiat === '' ? NaN : Number(rawFiat);
      const storedPrice = Number(existingTrade.price ?? existingTrade.unit_price ?? existingTrade.rate);
      const storedCrypto = Number(existingTrade.crypto_amount);
      const storedFiat = Number(existingTrade.fiat_amount);
      const requestedCrypto = Number.isFinite(retryCryptoRaw) && retryCryptoRaw > 0
        ? Number(retryCryptoRaw.toFixed(8))
        : (Number.isFinite(retryFiatRaw) && retryFiatRaw > 0 && storedPrice > 0
          ? Number((retryFiatRaw / storedPrice).toFixed(8))
          : NaN);
      const requestedPayment = typeof customPaymentMethod === 'string' ? customPaymentMethod.trim().toLowerCase() : '';
      const storedPayment = String(existingTrade.payment_method ?? '').trim().toLowerCase();
      const retryAmountsValid =
        Number.isFinite(requestedCrypto) &&
        Number.isFinite(storedPrice) && storedPrice > 0 &&
        requestedCrypto === storedCrypto &&
        Number((requestedCrypto * storedPrice).toFixed(2)) === storedFiat &&
        (!Number.isFinite(retryFiatRaw) || retryFiatRaw <= 0 || Number(retryFiatRaw.toFixed(2)) === storedFiat);

      if (!callerIsParticipant || !adMatches || !retryAmountsValid ||
          (requestedPayment !== '' && requestedPayment !== storedPayment)) {
        return NextResponse.json(
          { success: false, code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT', error: 'This idempotency key was already used for a different or unauthorized trade request.' },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        tradeId: existingTrade.id,
        id: existingTrade.id,
        publicId: existingTrade.public_id,
        message: 'Trade already initiated (idempotent replay)',
        data: {
          success: true,
          trade_id: existingTrade.id,
          public_id: existingTrade.public_id,
          buyer_id: existingTrade.buyer_id,
          seller_id: existingTrade.seller_id,
          crypto_amount: existingTrade.crypto_amount,
          fiat_amount: existingTrade.fiat_amount,
          fiat_currency: existingTrade.fiat_currency,
          asset: existingTrade.crypto || existingTrade.asset_code,
          status: existingTrade.status,
          escrow_status: existingTrade.escrow_status,
          message: 'Trade already initiated (idempotent replay)',
        },
        trade: {
          trade_id: existingTrade.id,
          public_id: existingTrade.public_id,
          buyer_id: existingTrade.buyer_id,
          seller_id: existingTrade.seller_id,
          crypto_amount: existingTrade.crypto_amount,
          fiat_amount: existingTrade.fiat_amount,
          fiat_currency: existingTrade.fiat_currency,
          asset: existingTrade.crypto || existingTrade.asset_code,
          status: existingTrade.status,
          escrow_status: existingTrade.escrow_status,
          message: 'Trade already initiated (idempotent replay)',
        },
      });
    }

    const isIdUUID = isValidUUID(adId);

    // 1. Fetch Ad safely to read metadata
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},id.eq.${adId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', adId).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_ad_id.eq.${adId},id.eq.${adId}`).maybeSingle();
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

    // 3. Resolve numerical amounts with exact precision
    // Use the ad's stored price only; client-supplied price/rate is untrusted.
    const rawPrice = ad.price ?? ad.unit_price ?? ad.fixed_rate;
    const unitPrice = Number(rawPrice);
    if (!rawPrice || isNaN(unitPrice) || unitPrice <= 0) {
      return NextResponse.json(
        { error: 'Advertisement unit price is invalid or market price is unavailable.' },
        { status: 400 }
      );
    }
    let calculatedCrypto = parseFloat(rawCrypto);
    let numericFiat = parseFloat(rawFiat);

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      if (!isNaN(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (isNaN(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));

    // 4. Resolve Payment Method & Currency
    let rawPaymentMethods: any[] = [];
    if (Array.isArray(ad.payment_methods)) {
      rawPaymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        rawPaymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        rawPaymentMethods = [ad.payment_methods];
      }
    } else if (ad.payment_method) {
      rawPaymentMethods = [ad.payment_method];
    } else {
      rawPaymentMethods = ['Bank Transfer'];
    }

    const paymentMethods: string[] = rawPaymentMethods.filter((m: any) => typeof m === 'string' && m.trim().length > 0);

    let resolvedPaymentMethod = '';
    const trimmedCustom = typeof customPaymentMethod === 'string' ? customPaymentMethod.trim() : '';

    if (paymentMethods.length > 1) {
      if (!trimmedCustom) {
        return NextResponse.json({ error: 'Please select a payment method for this advertisement.' }, { status: 400 });
      }
      const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedCustom.toLowerCase());
      if (!matched) {
        return NextResponse.json({ error: `Selected payment method "${trimmedCustom}" is not supported by this advertisement.` }, { status: 400 });
      }
      resolvedPaymentMethod = matched;
    } else if (paymentMethods.length === 1) {
      if (trimmedCustom) {
        const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedCustom.toLowerCase());
        if (!matched) {
          return NextResponse.json({ error: `Selected payment method "${trimmedCustom}" is not supported by this advertisement.` }, { status: 400 });
        }
        resolvedPaymentMethod = matched;
      } else {
        resolvedPaymentMethod = paymentMethods[0];
      }
    } else {
      resolvedPaymentMethod = trimmedCustom || 'Bank Transfer';
    }

    // Use the ad's stored fiat currency only; client-supplied currency is untrusted.
    const resolvedFiatCurrency = ad.fiat_symbol || ad.fiat_currency || ad.fiat || 'USD';
    const adIdentifier = String(ad.id || ad.public_ad_id || adId);

    // 5. Call Canonical Atomic Database RPC
    const { data: rpcResult, error: rpcError } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: tradeRef,
      p_idempotency_key: idempotencyKey,
      p_caller_id: user.id,
    });

    if (rpcError) {
      console.error('[trades/initiate] RPC initiate_trade_with_escrow error:', rpcError);
      return NextResponse.json(
        {
          success: false,
          code: rpcError.code === 'P0001' ? 'ESCROW_ERROR' : 'RPC_ERROR',
          error: rpcError.message || 'Failed to initiate trade with escrow.',
        },
        { status: 400 }
      );
    }

    if (!rpcResult || rpcResult.success === false) {
      return NextResponse.json(
        {
          success: false,
          code: 'ESCROW_FAILED',
          error: rpcResult?.message || 'Failed to initiate trade with escrow.',
        },
        { status: 400 }
      );
    }

    const tradeId = rpcResult.trade_id;
    const publicId = rpcResult.public_id || tradeRef;
    const sellerId = rpcResult.seller_id || ad.user_id;
    const buyerId = rpcResult.buyer_id || user.id;

    if (tradeId && resolvedPaymentMethod) {
      const adminClient = getSupabaseAdminClient();
      await adminClient
        .from('trades')
        .update({ payment_method: resolvedPaymentMethod })
        .eq('id', tradeId);
    }

    // Send Email Notification to Seller (Non-blocking & Duplicate-Protected)
    if (!rpcResult.message?.includes('idempotent replay') && sellerId) {
      try {
        void sendNewTradeNotificationEmail({
          tradeId: String(tradeId),
          publicId: String(publicId),
          sellerId: String(sellerId),
          buyerId: String(buyerId),
          cryptoAmount: calculatedCrypto,
          fiatAmount: numericFiat,
          fiatCurrency: resolvedFiatCurrency,
          asset: String(rpcResult.asset || ad.crypto || 'USDT'),
          price: unitPrice,
          paymentMethod: resolvedPaymentMethod,
          status: 'pending',
          createdAt: new Date().toISOString(),
        }).catch((emailErr) => {
          console.error('[Trades/Initiate] Email notification failure notice:', emailErr);
        });
      } catch (emailTriggerErr) {
        console.error('[Trades/Initiate] Email trigger notice:', emailTriggerErr);
      }
    }

    return NextResponse.json({
      success: true,
      tradeId: tradeId,
      id: tradeId,
      publicId: publicId,
      message: 'Trade initiated successfully. Escrow locked.',
      data: rpcResult,
      trade: rpcResult,
    });
  } catch (err: any) {
    console.error('Error initiating trade:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
