import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { generateTradeId } from '@/lib/id-generator';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { hasPendingWithdrawalApproval } from '@/lib/withdrawal-security';
import { isTier2User } from '@/lib/kyc';
import { checkNewTradeEligibility } from '@/lib/account-action-guard';
import { validateAdFiatLimits } from '@/lib/trade-ad-limits';
import { validateEscrowTradeReceipt } from '@/lib/escrow-trade-response';
import { checkAdOwnerAvailability } from '@/lib/ad-owner-availability';

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

    const eligibility = await checkNewTradeEligibility(user.id);
    if (!eligibility.allowed) {
      return NextResponse.json({ error: eligibility.message, code: eligibility.code }, { status: eligibility.statusCode });
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

    const {
      adId,
      cryptoAmount,
      fiatAmount,
      paymentMethod,
      tradeRef,
      idempotencyKey,
    } = body;

    const rawIdempotencyKey =
      idempotencyKey ??
      req.headers.get('x-idempotency-key') ??
      req.headers.get('idempotency-key') ??
      '';
    const resolvedIdempotencyKey = typeof rawIdempotencyKey === 'string'
      ? rawIdempotencyKey.trim()
      : '';

    if (!resolvedIdempotencyKey) {
      return NextResponse.json({
        error: 'Idempotency key is required to create a trade order.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      }, { status: 400 });
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(resolvedIdempotencyKey)) {
      return NextResponse.json({ error: 'Invalid idempotency key format.', code: 'INVALID_IDEMPOTENCY_KEY' }, { status: 400 });
    }
    if (tradeRef !== undefined && tradeRef !== null &&
        (typeof tradeRef !== 'string' || tradeRef.trim().length === 0 || tradeRef.trim().length > 128)) {
      return NextResponse.json({ error: 'Trade reference is invalid.', code: 'INVALID_TRADE_REFERENCE' }, { status: 400 });
    }

    const cleanAdId = typeof adId === 'string' ? adId.trim().replace(/^#/, '') : '';
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(cleanAdId)) {
      return NextResponse.json({ error: 'Advertisement identifier is invalid.', code: 'INVALID_ADVERTISEMENT_ID' }, { status: 400 });
    }
    const parsedCryptoInput = Number(cryptoAmount);
    const parsedFiatInput = Number(fiatAmount);
    if (
      (!Number.isFinite(parsedCryptoInput) || parsedCryptoInput <= 0) &&
      (!Number.isFinite(parsedFiatInput) || parsedFiatInput <= 0)
    ) {
      return NextResponse.json({ error: 'A positive crypto or fiat amount is required.' }, { status: 400 });
    }

    const isIdUUID = isValidUUID(cleanAdId);

    // 1. Fetch Ad safely to read metadata & verification rules
    let ad: any = null;
    let p2pQuery = supabase.from('p2p_ads').select('*');
    if (isIdUUID) {
      p2pQuery = p2pQuery.or(`id.eq.${cleanAdId},public_ad_id.eq.${cleanAdId}`);
    } else {
      p2pQuery = p2pQuery.or(`public_ad_id.eq.${cleanAdId},id.eq.${cleanAdId}`);
    }
    const { data: p2pAd } = await p2pQuery.maybeSingle();

    if (p2pAd) {
      ad = p2pAd;
    } else {
      if (isIdUUID) {
        const { data: primaryAd } = await supabase.from('ads').select('*').eq('id', cleanAdId).maybeSingle();
        if (primaryAd) ad = primaryAd;
      } else {
        const { data: primaryAd } = await supabase.from('ads').select('*').or(`public_ad_id.eq.${cleanAdId},id.eq.${cleanAdId}`).maybeSingle();
        if (primaryAd) ad = primaryAd;
      }
    }

    if (!ad) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    if (ad.user_id === user.id) {
      return NextResponse.json(
        { error: 'You cannot trade with your own advertisement.' },
        { status: 400 }
      );
    }

    if (ad) {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('full_name, display_name, kyc_status')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('[POST /api/p2p/orders/create] Buyer profile eligibility lookup failed:', profileError.code || 'UNKNOWN');
        return NextResponse.json(
          { error: 'Unable to verify the buyer profile requirements. Please try again.', code: 'BUYER_PROFILE_UNAVAILABLE' },
          { status: 503 }
        );
      }

      const hasFullName = Boolean(
        profile?.full_name?.trim() ||
        profile?.display_name?.trim() ||
        user.user_metadata?.full_name?.trim() ||
        user.user_metadata?.name?.trim()
      );
      const isKycVerified = isTier2User(profile);

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

    // 2. Resolve calculation using the stored advertisement price only.
    // Client-supplied price is deliberately ignored to prevent price tampering.
    const rawStoredPrice = ad.fixed_rate ?? ad.price;
    const unitPrice = Number(rawStoredPrice);
    if (!rawStoredPrice || !Number.isFinite(unitPrice) || unitPrice <= 0) {
      return NextResponse.json({ error: 'Advertisement unit price is invalid or unavailable.' }, { status: 400 });
    }
    let calculatedCrypto = parsedCryptoInput;
    let numericFiat = parsedFiatInput;

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      if (Number.isFinite(numericFiat) && numericFiat > 0 && unitPrice > 0) {
        calculatedCrypto = numericFiat / unitPrice;
      }
    }

    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0) {
      return NextResponse.json({ error: 'Invalid crypto amount.' }, { status: 400 });
    }

    calculatedCrypto = Number(calculatedCrypto.toFixed(8));
    numericFiat = Number((calculatedCrypto * unitPrice).toFixed(2));
    if (!Number.isFinite(calculatedCrypto) || calculatedCrypto <= 0 || !Number.isFinite(numericFiat) || numericFiat <= 0) {
      return NextResponse.json({ error: 'Trade amount is outside the supported numeric range.' }, { status: 400 });
    }
    const limitError = validateAdFiatLimits(ad, numericFiat);
    if (limitError) return NextResponse.json({ error: limitError }, { status: 400 });

    let paymentMethods: unknown[] = [];
    if (Array.isArray(ad.payment_methods)) {
      paymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        paymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        paymentMethods = [ad.payment_methods];
      }
    } else if (typeof ad.payment_method === 'string') {
      paymentMethods = [ad.payment_method];
    }
    const validPaymentMethods = paymentMethods.filter(
      (method): method is string => typeof method === 'string' && method.trim().length > 0
    );
    const requestedPaymentMethod = typeof paymentMethod === 'string' ? paymentMethod.trim() : '';
    const resolvedPaymentMethod = requestedPaymentMethod
      ? validPaymentMethods.find((method) => method.trim().toLowerCase() === requestedPaymentMethod.toLowerCase())
      : validPaymentMethods.length === 1 ? validPaymentMethods[0] : undefined;
    if (!resolvedPaymentMethod) {
      return NextResponse.json({ error: 'Select a payment method supported by this advertisement.' }, { status: 400 });
    }
    // Currency is authoritative on the stored advertisement; ignore client override.
    const resolvedFiatCurrency = ad.fiat_currency || ad.fiat || 'USD';
    const shortRef = typeof tradeRef === 'string' && tradeRef.trim()
      ? tradeRef.trim()
      : generateTradeId();
    const adIdentifier = String(ad.id || ad.public_ad_id || cleanAdId);

    const availabilityResponse = await checkAdOwnerAvailability(supabase, adIdentifier, resolvedIdempotencyKey);
    if (availabilityResponse) return availabilityResponse;

    // 3. Call Atomic Database RPC initiate_trade_with_escrow
    const { data, error } = await supabase.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: calculatedCrypto,
      p_fiat_amount: numericFiat,
      p_fiat_currency: resolvedFiatCurrency,
      p_price: unitPrice,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: shortRef,
      p_idempotency_key: resolvedIdempotencyKey,
      p_caller_id: user.id,
    });

    if (error) {
      console.error('[POST /api/p2p/orders/create] RPC error:', { code: error.code || 'UNKNOWN' });
      return NextResponse.json({
        success: false,
        error: 'Unable to initiate this trade. Please review the trade details and try again.',
        code: error.code === 'P0001' ? 'ESCROW_ERROR' : 'RPC_ERROR',
      }, { status: 400 });
    }

    const receipt = validateEscrowTradeReceipt(data, {
      callerId: user.id,
      adOwnerId: String(ad.user_id || ''),
      adType: String(ad.trade_type || ad.ad_type || ad.type || ad.side || ''),
      cryptoAmount: calculatedCrypto,
      fiatAmount: numericFiat,
    });
    if (!receipt.valid) {
      console.error('[POST /api/p2p/orders/create] Escrow RPC receipt validation failed:', receipt.reason);
      return NextResponse.json({
        success: false,
        error: 'Unable to verify trade initiation. Check your trades before retrying.',
        code: 'ESCROW_RESPONSE_INVALID',
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      tradeId: receipt.tradeId,
      id: receipt.tradeId,
      publicId: receipt.publicId,
      data,
    }, { status: 201 });
  } catch (err: any) {
    console.error('Error creating order trade:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
