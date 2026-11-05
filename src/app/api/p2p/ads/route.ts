import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { generateAdId } from '@/lib/id-generator';
import { getMinimumFiatAmountFromUsd } from '@/lib/currency.server';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;
    const supabase = bearerToken ? createBearerClient(bearerToken) : await createClient();

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
      return NextResponse.json({ error: 'Advertisement request is too large.' }, { status: 413 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid advertisement JSON object is required.' }, { status: 400 });
    }

    // 1. Authenticate user session
    let user: any = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (!user) {
      return NextResponse.json(
        { 
          error: 'No active session found! Please refresh or log in again.', 
          details: authError?.message || 'Authentication required'
        }, 
        { status: 401 }
      );
    }

    // Platform Guard Check
    try {
      await assertPlatformControlAllowed('new_ad', { userId: user.id });
    } catch (guardErr: any) {
      return NextResponse.json(
        { error: guardErr.message || 'Creating new advertisements is temporarily disabled.', code: guardErr.code || 'PLATFORM_AD_CREATION_DISABLED' },
        { status: guardErr.statusCode || 403 }
      );
    }

    // Require the profile created by the verified signup flow. Ad creation must not
    // auto-provision identity or account records from user-editable Auth metadata.
    // Enforce account restrictions at the API boundary as well as in database triggers.
    const accountAdmin = getSupabaseAdminClient();
    const { data: accountProfile, error: accountProfileError } = await accountAdmin
      .from('profiles')
      .select('is_banned, is_restricted, is_suspended, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (accountProfileError || !accountProfile) {
      console.error('[P2P_AD_CREATE] account eligibility lookup failed:', accountProfileError?.code || 'profile_missing');
      return NextResponse.json({ error: 'Account eligibility could not be verified. Please retry.', code: 'ACCOUNT_STATUS_UNAVAILABLE' }, { status: 503 });
    }
    const profileStatus = String(accountProfile.status || '').toLowerCase();
    const accountStatus = String(accountProfile.account_status || '').toUpperCase();
    if (
      accountProfile.is_banned === true ||
      accountProfile.is_restricted === true ||
      accountProfile.is_suspended === true ||
      accountProfile.is_on_hold === true ||
      accountProfile.is_emergency_frozen === true ||
      accountProfile.is_minor_restricted === true ||
      ['banned', 'restricted', 'suspended', 'deleted', 'inactive', 'on_hold', 'hold'].includes(profileStatus) ||
      ['BANNED', 'RESTRICTED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING', 'DELETED', 'INACTIVE'].includes(accountStatus)
    ) {
      return NextResponse.json({ error: 'Your account is not allowed to create new advertisements.', code: 'ACCOUNT_AD_ACCESS_BLOCKED' }, { status: 403 });
    }

    const readString = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';
    const coinType = readString(
      body.coin || body.crypto || body.crypto_currency || body.asset_symbol || body.asset || 'USDT'
    ).toUpperCase();
    const fiatType = readString(
      body.fiat || body.fiat_currency || body.fiat_symbol || 'USD'
    ).toUpperCase();
    const supportedAssets = new Set(['USDT', 'BTC', 'ETH', 'LTC']);

    if (!supportedAssets.has(coinType)) {
      return NextResponse.json({ error: 'Unsupported cryptocurrency.', code: 'UNSUPPORTED_ASSET' }, { status: 400 });
    }
    if (!FIAT_CURRENCIES.some((fiat) => fiat.code.toUpperCase() === fiatType)) {
      return NextResponse.json({ error: 'Unsupported fiat currency.', code: 'UNSUPPORTED_FIAT' }, { status: 400 });
    }

    const adSide = resolveTradeType(body);
    if (adSide !== 'BUY') {
      return NextResponse.json(
        {
          success: false,
          error: 'SELL advertisements are temporarily unavailable until atomic crypto inventory reservation is enabled.',
          code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
        },
        { status: 503 }
      );
    }

    const toFiniteNumber = (value: unknown): number | null => {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      const result = Number(value);
      return Number.isFinite(result) ? result : null;
    };
    const requestedMax = toFiniteNumber(body.max_amount ?? body.max_limit ?? body.maxAmount);
    const requestedMin = toFiniteNumber(body.min_amount ?? body.min_limit ?? body.minAmount);
    if (
      requestedMin === null || requestedMax === null ||
      requestedMin <= 0 || requestedMax <= 0 || requestedMax < requestedMin ||
      requestedMax >= 1e18
    ) {
      return NextResponse.json({ error: 'Valid positive minimum and maximum trade limits are required.' }, { status: 400 });
    }

    const dynamicMinThreshold = await getMinimumFiatAmountFromUsd(10.00, fiatType);
    if (dynamicMinThreshold === null) {
      return NextResponse.json({
        success: false,
        error: `The USD conversion rate for ${fiatType} is temporarily unavailable. Ad creation is paused to verify the minimum trade amount.`,
        code: 'FIAT_RATE_UNAVAILABLE',
      }, { status: 503 });
    }
    if (requestedMin < dynamicMinThreshold) {
      return NextResponse.json({
        error: `Minimum trade limit must be at least ${dynamicMinThreshold} ${fiatType} (equivalent to $10.00 USD).`,
        code: 'MIN_LIMIT_TOO_LOW',
      }, { status: 400 });
    }

    const pricingType = readString(body.pricing_type || (body.rate_type === 'fixed' || body.is_fixed === true ? 'FIXED' : 'FLOAT')).toUpperCase();
    if (pricingType !== 'FIXED' && pricingType !== 'FLOAT') {
      return NextResponse.json({ error: 'Invalid ad pricing type.' }, { status: 400 });
    }
    const marginVal = toFiniteNumber(body.margin ?? body.rate_percent ?? body.margin_percentage ?? body.price_margin ?? 0);
    if (marginVal === null || marginVal < -50 || marginVal > 50) {
      return NextResponse.json({ error: 'Margin percentage must be between -50% and +50%.' }, { status: 400 });
    }

    const rawPaymentWindow = Number.parseInt(String(body.payment_window ?? body.payment_window_minutes ?? 30), 10);
    if (!Number.isInteger(rawPaymentWindow) || rawPaymentWindow < 30 || rawPaymentWindow > 1440) {
      return NextResponse.json({ error: 'Payment window must be between 30 and 1440 minutes.' }, { status: 400 });
    }

    const rawPaymentMethods: unknown[] = Array.isArray(body.payment_methods)
      ? body.payment_methods
      : Array.isArray(body.paymentMethods)
        ? body.paymentMethods
        : typeof body.payment_method === 'string'
          ? [body.payment_method]
          : [];
    const paymentMethods = rawPaymentMethods
      .filter((method): method is string => typeof method === 'string')
      .map((method) => method.trim())
      .filter((method) => method.length > 0 && method.length <= 100);
    if (paymentMethods.length < 1 || paymentMethods.length > 20) {
      return NextResponse.json({ error: 'Select between one and twenty valid payment methods.' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data: marketRow, error: marketError } = await adminClient
      .from('crypto_market_prices')
      .select('price_in_fiat, updated_at')
      .eq('asset_symbol', coinType)
      .eq('fiat_symbol', fiatType)
      .maybeSingle();

    if (marketError || !marketRow) {
      return NextResponse.json({ error: `Market reference price is unavailable for ${coinType}/${fiatType}.`, code: 'MARKET_PRICE_UNAVAILABLE' }, { status: 503 });
    }
    const referencePrice = toFiniteNumber(marketRow.price_in_fiat);
    const marketUpdatedAt = marketRow.updated_at ? Date.parse(marketRow.updated_at) : Number.NaN;
    const marketAgeMs = Date.now() - marketUpdatedAt;
    if (
      referencePrice === null || referencePrice <= 0 ||
      !Number.isFinite(marketUpdatedAt) ||
      marketAgeMs < -60_000 || marketAgeMs > 10 * 60_000
    ) {
      return NextResponse.json({ error: `A current market reference price is unavailable for ${coinType}/${fiatType}.`, code: 'MARKET_PRICE_STALE' }, { status: 503 });
    }

    let priceVal: number;
    if (pricingType === 'FIXED') {
      const fixedPrice = toFiniteNumber(body.price ?? body.fixed_price ?? body.fixedPrice);
      if (fixedPrice === null || fixedPrice <= 0 || fixedPrice >= 1e18) {
        return NextResponse.json({ error: 'A finite positive fixed price is required.' }, { status: 400 });
      }
      const minAllowedPrice = referencePrice * 0.5;
      const maxAllowedPrice = referencePrice * 1.5;
      if (fixedPrice < minAllowedPrice || fixedPrice > maxAllowedPrice) {
        return NextResponse.json({
          error: `Fixed price must be within ±50% of the reference market price (${minAllowedPrice.toFixed(2)} - ${maxAllowedPrice.toFixed(2)} ${fiatType}).`,
          code: 'FIXED_PRICE_OUTSIDE_MARKET_RANGE',
        }, { status: 400 });
      }
      priceVal = fixedPrice;
    } else {
      priceVal = referencePrice * (1 + marginVal / 100);
      if (!Number.isFinite(priceVal) || priceVal <= 0 || priceVal >= 1e18) {
        return NextResponse.json({ error: 'The calculated floating ad price is invalid.' }, { status: 400 });
      }
    }

    const optionalText = (value: unknown, maxLength: number): string | null => {
      if (value === undefined || value === null) return null;
      if (typeof value !== 'string') return null;
      const clean = value.trim();
      return clean.length <= maxLength ? clean : null;
    };
    const terms = optionalText(body.terms ?? body.terms_conditions ?? body.termsAndConditions ?? '', 2000);
    const offerLabel = optionalText(body.offer_label ?? body.label ?? body.offerLabel ?? '', 80);
    const autoReply = optionalText(body.auto_reply ?? body.autoReply ?? '', 1000);
    if (terms === null || offerLabel === null || autoReply === null) {
      return NextResponse.json({ error: 'Advertisement text fields exceed their allowed size.' }, { status: 400 });
    }

    const normalizeCountryList = (value: unknown): string[] | null => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.length > 100) return null;
      const countries = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase());
      if (countries.length !== value.length || countries.some((item) => !/^[a-z]{2}$/.test(item))) return null;
      return Array.from(new Set(countries));
    };
    const targetedCountries = normalizeCountryList(body.targeted_countries ?? body.targetedCountries);
    const blockedCountries = normalizeCountryList(body.blocked_countries ?? body.blockedCountries);
    if (targetedCountries === null || blockedCountries === null) {
      return NextResponse.json({ error: 'Country restrictions must contain valid ISO alpha-2 codes.' }, { status: 400 });
    }

    const rawTags = body.ad_tags ?? body.tags;
    if (rawTags !== undefined && rawTags !== null && !Array.isArray(rawTags)) {
      return NextResponse.json({ error: 'Advertisement tags must be a list.' }, { status: 400 });
    }
    const tagsInput = Array.isArray(rawTags) ? rawTags : [];
    if (tagsInput.length > 20 || tagsInput.some((tag) => typeof tag !== 'string' || tag.trim().length > 40)) {
      return NextResponse.json({ error: 'Advertisement tags must contain at most twenty strings of forty characters each.' }, { status: 400 });
    }
    const tags = Array.from(new Set(tagsInput.map((tag: string) => tag.trim()).filter(Boolean)));

    const rawMinimumTrades = Number.parseInt(String(body.min_completed_trades ?? body.min_completed_trades_req ?? 0), 10);
    if (!Number.isInteger(rawMinimumTrades) || rawMinimumTrades < 0 || rawMinimumTrades > 1000000) {
      return NextResponse.json({ error: 'Minimum completed trades must be a valid non-negative integer.' }, { status: 400 });
    }

    const uniqueAdId = generateAdId();
    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_buy_ad_atomic', {
      p_public_ad_id: uniqueAdId,
      p_asset: coinType,
      p_fiat: fiatType,
      p_price: priceVal,
      p_min_amount: requestedMin,
      p_max_amount: requestedMax,
      p_pricing_type: pricingType,
      p_margin: marginVal,
      p_payment_methods: paymentMethods,
      p_payment_window: rawPaymentWindow,
      p_terms: terms,
      p_offer_label: offerLabel,
      p_auto_reply: autoReply,
      p_tags: tags,
      p_targeted_countries: targetedCountries,
      p_blocked_countries: blockedCountries,
      p_min_completed_trades: rawMinimumTrades,
      p_require_full_name_verified: body.require_full_name_verified === true || body.requireFullNameVerified === true,
      p_require_verified_users: body.require_verified_users === true || body.requireVerifiedUsers === true,
    });

    if (rpcError || !rpcResult || rpcResult.success !== true) {
      console.error('[P2P_AD_CREATE] Atomic ad creation RPC rejected:', rpcError?.code || 'invalid_rpc_response');
      const errorCode = rpcError?.code || 'AD_CREATE_FAILED';
      const status = errorCode === '42501' ? 403
        : errorCode === '22023' ? 400
        : errorCode === '23505' ? 409
        : 503;
      return NextResponse.json(
        {
          success: false,
          error: rpcError?.code === '42501'
            ? 'Your account or platform settings do not permit advertisement creation.'
            : 'Advertisement could not be created in both marketplace records. No partial listing was committed.',
          code: errorCode,
        },
        { status }
      );
    }

    const committedPrice = toFiniteNumber(rpcResult.price);
    if (
      typeof rpcResult.ad_id !== 'string' ||
      !/^[A-Za-z0-9]{12}$/.test(rpcResult.ad_id) ||
      rpcResult.public_ad_id !== uniqueAdId ||
      typeof rpcResult.p2p_ad_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rpcResult.p2p_ad_id) ||
      committedPrice === null ||
      committedPrice <= 0
    ) {
      console.error('[P2P_AD_CREATE] Atomic ad creation returned an invalid receipt after commit.');
      return NextResponse.json(
        { success: false, error: 'The ad was committed but its receipt could not be verified. Contact support before retrying.', code: 'AD_CREATE_RECEIPT_INVALID' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        id: rpcResult.ad_id,
        public_id: rpcResult.public_ad_id,
        public_ad_id: rpcResult.public_ad_id,
        p2p_ad_id: rpcResult.p2p_ad_id,
        user_id: user.id,
        type: 'BUY',
        trade_type: 'BUY',
        asset_symbol: coinType,
        fiat_symbol: fiatType,
        price: committedPrice,
        min_limit: requestedMin,
        max_limit: requestedMax,
        status: 'ACTIVE',
        active: true,
        is_active: true,
      },
    });
  } catch (err: any) {
    console.error('Unhandled ad creation error:', err);
    return NextResponse.json(
      { 
        error: err.message || 'Internal Server Error',
        realError: String(err)
      }, 
      { status: 500 }
    );
  }
}
