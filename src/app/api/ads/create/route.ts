import { NextResponse } from 'next/server';
import { createClient, createBearerClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import { getMinimumFiatAmountFromUsd } from '@/lib/currency.server';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { generateAdId } from '@/lib/id-generator';

export const dynamic = 'force-dynamic';

const VALID_SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'LTC'];

export async function POST(req: Request) {
  try {
    // Use exactly one verified credential source. An explicit Bearer token
    // must validate and must not fall back to a different cookie user.
    const authHeader = req.headers.get('authorization');
    const bearerMatch = authHeader !== null ? /^Bearer\s+(.+)$/i.exec(authHeader) : null;
    const bearerToken = bearerMatch?.[1]?.trim() || null;

    if (authHeader !== null && !bearerToken) {
      return NextResponse.json({ error: 'A valid Bearer authorization token is required.' }, { status: 401 });
    }

    const supabase = bearerToken ? createBearerClient(bearerToken) : await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user || null;

    if (authError || !user) {
      return NextResponse.json(
        { error: 'No active session found. Please refresh or log in again.' },
        { status: 401 },
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

    // A user restriction must block new ads even if a database trigger is missing or delayed.
    const accountAdmin = getSupabaseAdminClient();
    const { data: accountProfile, error: accountProfileError } = await accountAdmin
      .from('profiles')
      .select('is_banned, is_restricted, is_suspended, status, account_status')
      .eq('id', user.id)
      .maybeSingle();
    if (accountProfileError || !accountProfile) {
      console.error('[ADS_CREATE] account eligibility lookup failed:', accountProfileError?.code || 'profile_missing');
      return NextResponse.json({ error: 'Account eligibility could not be verified. Please retry.', code: 'ACCOUNT_STATUS_UNAVAILABLE' }, { status: 503 });
    }
    const profileStatus = String(accountProfile.status || '').trim().toLowerCase();
    const accountStatus = String(accountProfile.account_status || '').trim().toUpperCase();
    if (accountProfile.is_banned === true || accountProfile.is_restricted === true || accountProfile.is_suspended === true ||
        ['banned', 'restricted', 'suspended', 'deleted', 'on_hold', 'hold'].includes(profileStatus) ||
        ['BANNED', 'RESTRICTED', 'SUSPENDED', 'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING', 'DELETED'].includes(accountStatus)) {
      return NextResponse.json({ error: 'Your account is not allowed to create new advertisements.', code: 'ACCOUNT_AD_ACCESS_BLOCKED' }, { status: 403 });
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 16 * 1024) {
      return NextResponse.json({ error: 'Advertisement request is too large.' }, { status: 413 });
    }
    const formData = await req.json().catch(() => null);
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      return NextResponse.json({ error: 'A valid advertisement JSON object is required.' }, { status: 400 });
    }

    // 2. Strip client-controlled identity, row lifecycle, inventory and administrative fields.
    const strippedFormData = { ...formData };
    delete strippedFormData.user_id;
    delete strippedFormData.userId;
    delete strippedFormData.owner_id;
    delete strippedFormData.seller_id;
    delete strippedFormData.creator_id;
    delete strippedFormData.is_admin;
    delete strippedFormData.admin;
    delete strippedFormData.role;
    delete strippedFormData.verification_status;
    delete strippedFormData.is_verified;
    delete strippedFormData.id;
    delete strippedFormData.public_id;
    delete strippedFormData.public_ad_id;
    delete strippedFormData.created_at;
    delete strippedFormData.updated_at;
    delete strippedFormData.status;
    delete strippedFormData.active;
    delete strippedFormData.is_active;
    delete strippedFormData.is_deleted;
    delete strippedFormData.deleted_at;
    delete strippedFormData.available_amount;
    delete strippedFormData.surplus_amount;
    delete strippedFormData.verified_by;
    delete strippedFormData.approved_by;
    delete strippedFormData.moderation_status;
    delete strippedFormData.is_merchant;
    delete strippedFormData.merchant_tier;
    delete strippedFormData.user_display_name;

    // 3. Validate Supported Crypto Asset (USDT, BTC, ETH, LTC)
    const rawAsset = (
      strippedFormData.crypto || 
      strippedFormData.asset || 
      strippedFormData.asset_symbol || 
      strippedFormData.crypto_symbol || 
      strippedFormData.coin || 
      'USDT'
    ).toString().toUpperCase().trim();

    if (!VALID_SUPPORTED_ASSETS.includes(rawAsset)) {
      return NextResponse.json(
        { 
          error: `Unsupported cryptocurrency '${rawAsset}'. Supported assets are: ${VALID_SUPPORTED_ASSETS.join(', ')}.` 
        },
        { status: 400 }
      );
    }

    // 4. Validate Supported Fiat Currency
    const rawFiat = (
      strippedFormData.fiatCurrency || 
      strippedFormData.fiat || 
      strippedFormData.fiat_currency || 
      strippedFormData.fiat_symbol || 
      strippedFormData.currency || 
      'USD'
    ).toString().toUpperCase().trim();

    const isValidFiat = FIAT_CURRENCIES.some(f => f.code.toUpperCase() === rawFiat);
    if (!isValidFiat) {
      return NextResponse.json(
        { 
          error: `Unsupported fiat currency '${rawFiat}'. Please select a valid supported currency.` 
        },
        { status: 400 }
      );
    }

    // 5. Validate pricing mode and optional booleans without JavaScript truthiness.
    // Boolean("false") is true, so every supplied security/pricing flag is type-checked.
    const rawFixedFlag = strippedFormData.is_fixed ??
      (typeof strippedFormData.fixed_rate === 'boolean' ? strippedFormData.fixed_rate : undefined);
    if (rawFixedFlag !== undefined && typeof rawFixedFlag !== 'boolean') {
      return NextResponse.json({ error: 'is_fixed must be a boolean.' }, { status: 400 });
    }
    const rawPricingMode = strippedFormData.pricing_type ?? strippedFormData.rate_type;
    let requestedPricingMode: 'FIXED' | 'FLOAT' | undefined;
    if (rawPricingMode !== undefined && rawPricingMode !== null && rawPricingMode !== '') {
      const normalizedMode = String(rawPricingMode).trim().toUpperCase();
      if (normalizedMode === 'FIXED') requestedPricingMode = 'FIXED';
      else if (normalizedMode === 'FLOAT' || normalizedMode === 'FLOATING' || normalizedMode === 'MARKET') requestedPricingMode = 'FLOAT';
      else return NextResponse.json({ error: 'Pricing type must be FIXED or FLOAT.' }, { status: 400 });
    }
    if (requestedPricingMode !== undefined && rawFixedFlag !== undefined &&
        (requestedPricingMode === 'FIXED') !== rawFixedFlag) {
      return NextResponse.json({ error: 'Pricing type fields conflict.' }, { status: 400 });
    }
    const normalizedIsFixed = requestedPricingMode !== undefined
      ? requestedPricingMode === 'FIXED'
      : (rawFixedFlag === true);
    const requireFullNameValue = strippedFormData.require_full_name_verified ?? strippedFormData.requireFullNameVerified;
    const requireVerifiedUsersValue = strippedFormData.require_verified_users ?? strippedFormData.requireVerifiedUsers;
    if (requireFullNameValue !== undefined && typeof requireFullNameValue !== 'boolean') {
      return NextResponse.json({ error: 'require_full_name_verified must be a boolean.' }, { status: 400 });
    }
    if (requireVerifiedUsersValue !== undefined && typeof requireVerifiedUsersValue !== 'boolean') {
      return NextResponse.json({ error: 'require_verified_users must be a boolean.' }, { status: 400 });
    }

    // Sanitize numeric fields before database operations.
    const cleanPayload: Record<string, any> = {
      ...strippedFormData,
      asset: rawAsset,
      asset_symbol: rawAsset,
      crypto: rawAsset,
      crypto_symbol: rawAsset,
      coin: rawAsset,
      fiat: rawFiat,
      fiat_currency: rawFiat,
      fiat_symbol: rawFiat,
      currency: rawFiat,
      price: strippedFormData.price !== undefined && strippedFormData.price !== null && strippedFormData.price !== '' ? Number(strippedFormData.price) : null,
      margin: strippedFormData.margin !== undefined && strippedFormData.margin !== null && strippedFormData.margin !== '' ? Number(strippedFormData.margin) : (strippedFormData.price_margin ? Number(strippedFormData.price_margin) : null),
      min_amount: strippedFormData.min_amount !== undefined && strippedFormData.min_amount !== null && strippedFormData.min_amount !== '' ? Number(strippedFormData.min_amount) : (strippedFormData.min_order ? Number(strippedFormData.min_order) : null),
      max_amount: strippedFormData.max_amount !== undefined && strippedFormData.max_amount !== null && strippedFormData.max_amount !== '' ? Number(strippedFormData.max_amount) : (strippedFormData.max_order ? Number(strippedFormData.max_order) : null),
      is_fixed: normalizedIsFixed,
      pricing_type: normalizedIsFixed ? 'FIXED' : 'FLOAT',
      require_full_name_verified: requireFullNameValue === true,
      require_verified_users: requireVerifiedUsersValue === true,
    };

    if (typeof cleanPayload.fixed_rate === 'boolean') {
      delete cleanPayload.fixed_rate;
    }

    if (cleanPayload.min_order !== undefined) cleanPayload.min_order = cleanPayload.min_order ? Number(cleanPayload.min_order) : null;
    if (cleanPayload.max_order !== undefined) cleanPayload.max_order = cleanPayload.max_order ? Number(cleanPayload.max_order) : null;
    if (cleanPayload.total_amount !== undefined) cleanPayload.total_amount = cleanPayload.total_amount ? Number(cleanPayload.total_amount) : null;
    if (cleanPayload.available_amount !== undefined) cleanPayload.available_amount = cleanPayload.available_amount ? Number(cleanPayload.available_amount) : null;
    if (cleanPayload.rate_percent !== undefined) cleanPayload.rate_percent = cleanPayload.rate_percent ? Number(cleanPayload.rate_percent) : 0;
    if (cleanPayload.rate_adjustment !== undefined) cleanPayload.rate_adjustment = cleanPayload.rate_adjustment ? Number(cleanPayload.rate_adjustment) : 0;
    if (cleanPayload.margin_percentage !== undefined) cleanPayload.margin_percentage = cleanPayload.margin_percentage ? Number(cleanPayload.margin_percentage) : 0;
    if (cleanPayload.payment_window !== undefined) {
      const paymentWindow = Number(cleanPayload.payment_window);
      if (!Number.isInteger(paymentWindow) || paymentWindow < 30 || paymentWindow > 1440) {
        return NextResponse.json({ error: 'Payment window must be a whole number between 30 and 1440 minutes.' }, { status: 400 });
      }
      cleanPayload.payment_window = paymentWindow;
    }
    if (cleanPayload.min_completed_trades !== undefined) {
      const minimumTrades = Number(cleanPayload.min_completed_trades);
      if (!Number.isInteger(minimumTrades) || minimumTrades < 0 || minimumTrades > 1000000) {
        return NextResponse.json({ error: 'Minimum completed trades must be a whole number from 0 to 1000000.' }, { status: 400 });
      }
      cleanPayload.min_completed_trades = minimumTrades;
    }

    // This legacy endpoint is retained for compatibility, but callers cannot
    // choose a destination table or supply server-owned identity/lifecycle state.
    delete cleanPayload.table;

    // Normalize and strictly validate ad trade direction (BUY/SELL).
    const resolvedDirection = resolveTradeType(cleanPayload);
    if (!resolvedDirection) {
      return NextResponse.json(
        { error: 'Invalid or missing ad trade direction (BUY/SELL).' },
        { status: 400 }
      );
    }
    cleanPayload.trade_type = resolvedDirection;
    cleanPayload.type = resolvedDirection;

    // SELL inventory is not yet reserved per advertisement and restored
    // idempotently across cancellation, expiry, dispute and release. The
    // canonical escrow RPC independently rejects SELL, so reject creation
    // here too rather than publish listings that can never safely be traded.
    if (resolvedDirection === 'SELL') {
      return NextResponse.json({
        success: false,
        error: 'SELL advertisements are temporarily unavailable until atomic per-ad inventory reservation is enabled.',
        code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
      }, { status: 503 });
    }
    if (resolvedDirection !== 'BUY') {
      return NextResponse.json({ success: false, error: 'Unsupported advertisement direction.' }, { status: 400 });
    }

    // Financial, inventory and lifecycle fields are server-controlled. For BUY
    // ads, the available order amount is derived from the validated maximum.
    const finiteNumeric = (value: unknown): number | null => {
      if (typeof value !== 'number' && typeof value !== 'string') return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const priceValue = finiteNumeric(cleanPayload.price);
    const minValue = finiteNumeric(cleanPayload.min_amount);
    const maxValue = finiteNumeric(cleanPayload.max_amount);
    if (priceValue === null || priceValue <= 0) {
      return NextResponse.json({ error: 'A finite positive ad price is required.' }, { status: 400 });
    }
    if (minValue === null || minValue <= 0 || maxValue === null || maxValue <= 0 || maxValue < minValue) {
      return NextResponse.json({ error: 'Valid positive minimum and maximum trade limits are required.' }, { status: 400 });
    }

    const dynamicMinThreshold = await getMinimumFiatAmountFromUsd(10.00, rawFiat);
    if (dynamicMinThreshold === null) {
      return NextResponse.json({
        success: false,
        error: `The USD conversion rate for ${rawFiat} is temporarily unavailable. Ad creation is paused to verify the minimum trade amount.`,
        code: 'FIAT_RATE_UNAVAILABLE',
      }, { status: 503 });
    }
    if (minValue < dynamicMinThreshold) {
      return NextResponse.json({
        error: `Minimum trade limit must be at least ${dynamicMinThreshold} ${rawFiat} (equivalent to $10.00 USD).`,
        code: 'MIN_LIMIT_TOO_LOW',
      }, { status: 400 });
    }

    const rawMethods: unknown[] = Array.isArray(cleanPayload.payment_methods)
      ? cleanPayload.payment_methods
      : typeof cleanPayload.payment_methods === 'string'
        ? [cleanPayload.payment_methods]
        : Array.isArray(cleanPayload.paymentMethods)
          ? cleanPayload.paymentMethods
          : [];
    if (rawMethods.length < 1 || rawMethods.length > 20 ||
        rawMethods.some((method) => typeof method !== 'string' || !method.trim() || method.trim().length > 100)) {
      return NextResponse.json({ error: 'Select between one and twenty valid payment methods.' }, { status: 400 });
    }
    const paymentMethods = Array.from(new Set(rawMethods.map((method) => (method as string).trim())));
    if (paymentMethods.length === 0 || paymentMethods.length > 20) {
      return NextResponse.json({ error: 'Select between one and twenty valid payment methods.' }, { status: 400 });
    }

    const rawPaymentWindow = Number(cleanPayload.payment_window ?? 30);
    if (!Number.isInteger(rawPaymentWindow) || rawPaymentWindow < 30 || rawPaymentWindow > 1440) {
      return NextResponse.json({ error: 'Payment window must be between 30 and 1440 minutes.' }, { status: 400 });
    }

    const marginValue = finiteNumeric(cleanPayload.margin_percentage ?? cleanPayload.rate_percent ?? cleanPayload.margin ?? 0);
    if (marginValue === null || marginValue < -50 || marginValue > 50) {
      return NextResponse.json({ error: 'Margin percentage must be between -50% and +50%.' }, { status: 400 });
    }

    cleanPayload.price = priceValue;
    cleanPayload.unit_price = priceValue;
    cleanPayload.min_amount = minValue;
    cleanPayload.max_amount = maxValue;
    cleanPayload.min_limit = minValue;
    cleanPayload.max_limit = maxValue;
    cleanPayload.total_amount = maxValue;
    cleanPayload.available_amount = maxValue;
    cleanPayload.payment_methods = paymentMethods;
    cleanPayload.payment_window = rawPaymentWindow;
    cleanPayload.margin = marginValue;
    cleanPayload.margin_percentage = marginValue;
    cleanPayload.rate_percent = marginValue;
    cleanPayload.active = true;
    cleanPayload.is_active = true;
    cleanPayload.status = 'active';
    cleanPayload.is_deleted = false;

    // Authoritative Server-Side ±50% Reference Market Price Validation
    const isFixedPricing = normalizedIsFixed;
    const effectivePrice = priceValue;

    if (isFixedPricing) {
      if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        return NextResponse.json({ error: 'Valid fixed price is required for fixed-rate ads.' }, { status: 400 });
      }

      const { data: marketRow, error: marketError } = await supabase
        .from('crypto_market_prices')
        .select('price_in_fiat, updated_at')
        .eq('asset_symbol', rawAsset)
        .eq('fiat_symbol', rawFiat)
        .maybeSingle();

      if (marketError || !marketRow || !marketRow.price_in_fiat || Number(marketRow.price_in_fiat) <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${rawAsset}/${rawFiat}. Please try again later.` },
          { status: 400 }
        );
      }

      const refPrice = Number(marketRow.price_in_fiat);
      const marketUpdatedAt = marketRow.updated_at ? Date.parse(marketRow.updated_at) : Number.NaN;
      const marketAgeMs = Date.now() - marketUpdatedAt;
      if (
        !Number.isFinite(refPrice) ||
        refPrice <= 0 ||
        !Number.isFinite(marketUpdatedAt) ||
        marketAgeMs < -60_000 ||
        marketAgeMs > 10 * 60_000
      ) {
        return NextResponse.json(
          { error: `A current market reference price is unavailable for ${rawAsset}/${rawFiat}.` },
          { status: 503 }
        );
      }
      const minAllowedPrice = refPrice * 0.50;
      const maxAllowedPrice = refPrice * 1.50;

      if (effectivePrice < minAllowedPrice || effectivePrice > maxAllowedPrice) {
        return NextResponse.json(
          {
            error: `Fixed price must be within ±50% of the reference market price (${minAllowedPrice.toFixed(2)} - ${maxAllowedPrice.toFixed(2)} ${rawFiat}).`,
          },
          { status: 400 }
        );
      }
    } else {
      // Floating/margin pricing validation (-50% to +50%)
      const marginPct = marginValue;
      if (!Number.isFinite(marginPct) || marginPct < -50 || marginPct > 50) {
        return NextResponse.json(
          { error: 'Margin percentage for dynamic pricing must be between -50% and +50%.' },
          { status: 400 }
        );
      }
    }

    // Persist BUY ads through the same authenticated atomic RPC as the primary
    // P2P endpoint. Both marketplace tables commit together.
    const optionalText = (value: unknown, maxLength: number): string | null => {
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string') return null;
      const clean = value.trim();
      return clean.length <= maxLength ? clean : null;
    };
    const terms = optionalText(cleanPayload.terms ?? cleanPayload.terms_conditions, 2000);
    const offerLabel = optionalText(cleanPayload.offer_label ?? cleanPayload.label, 80);
    const autoReply = optionalText(cleanPayload.auto_reply ?? cleanPayload.autoReply, 1000);
    if (terms === null || offerLabel === null || autoReply === null) {
      return NextResponse.json({ error: 'Advertisement text fields exceed their allowed size.' }, { status: 400 });
    }

    const normalizeCountryList = (value: unknown): string[] | null => {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value) || value.length > 100) return null;
      const result = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().toLowerCase());
      if (result.length !== value.length || result.some((item) => !/^[a-z]{2}$/.test(item))) return null;
      return Array.from(new Set(result));
    };
    const targetedCountries = normalizeCountryList(cleanPayload.targeted_countries);
    const blockedCountries = normalizeCountryList(cleanPayload.blocked_countries);
    if (targetedCountries === null || blockedCountries === null) {
      return NextResponse.json({ error: 'Country restrictions must contain valid ISO alpha-2 codes.' }, { status: 400 });
    }

    const rawTags = cleanPayload.ad_tags ?? cleanPayload.tags;
    if (rawTags !== undefined && rawTags !== null && !Array.isArray(rawTags)) {
      return NextResponse.json({ error: 'Advertisement tags must be a list.' }, { status: 400 });
    }
    const tagsInput = Array.isArray(rawTags) ? rawTags : [];
    if (tagsInput.length > 20 || tagsInput.some((tag) => typeof tag !== 'string' || tag.trim().length > 40)) {
      return NextResponse.json({ error: 'Advertisement tags must contain at most twenty strings of forty characters each.' }, { status: 400 });
    }
    const tags = Array.from(new Set(tagsInput.map((tag: string) => tag.trim()).filter(Boolean)));

    const minimumTrades = Number.parseInt(String(cleanPayload.min_completed_trades ?? 0), 10);
    if (!Number.isInteger(minimumTrades) || minimumTrades < 0 || minimumTrades > 1000000) {
      return NextResponse.json({ error: 'Minimum completed trades must be a valid non-negative integer.' }, { status: 400 });
    }

    const uniqueAdId = generateAdId();
    const { data: rpcResult, error: rpcError } = await supabase.rpc('create_buy_ad_atomic', {
      p_public_ad_id: uniqueAdId,
      p_asset: rawAsset,
      p_fiat: rawFiat,
      p_price: priceValue,
      p_min_amount: minValue,
      p_max_amount: maxValue,
      p_pricing_type: isFixedPricing ? 'FIXED' : 'FLOAT',
      p_margin: marginValue,
      p_payment_methods: paymentMethods,
      p_payment_window: rawPaymentWindow,
      p_terms: terms,
      p_offer_label: offerLabel,
      p_auto_reply: autoReply,
      p_tags: tags,
      p_targeted_countries: targetedCountries,
      p_blocked_countries: blockedCountries,
      p_min_completed_trades: minimumTrades,
      p_require_full_name_verified: cleanPayload.require_full_name_verified,
      p_require_verified_users: cleanPayload.require_verified_users,
    });

    if (rpcError || !rpcResult || rpcResult.success !== true) {
      console.error('[ADS_CREATE] Atomic ad creation RPC rejected:', rpcError?.code || 'invalid_rpc_response');
      const errorCode = rpcError?.code || 'AD_CREATE_FAILED';
      const status = errorCode === '42501' ? 403
        : errorCode === '22023' ? 400
        : errorCode === '23505' ? 409
        : 503;
      return NextResponse.json(
        {
          success: false,
          error: 'Advertisement could not be created in both marketplace records. No partial listing was committed.',
          code: errorCode,
        },
        { status }
      );
    }

    const committedPrice = finiteNumeric(rpcResult.price);
    if (
      typeof rpcResult.ad_id !== 'string' ||
      !/^[A-Za-z0-9]{12}$/.test(rpcResult.ad_id) ||
      rpcResult.public_ad_id !== uniqueAdId ||
      typeof rpcResult.p2p_ad_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rpcResult.p2p_ad_id) ||
      committedPrice === null ||
      committedPrice <= 0
    ) {
      console.error('[ADS_CREATE] Atomic ad creation returned an invalid receipt after commit.');
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
        asset_symbol: rawAsset,
        fiat_symbol: rawFiat,
        price: committedPrice,
        min_limit: minValue,
        max_limit: maxValue,
        status: 'ACTIVE',
        active: true,
        is_active: true,
      },
    });

  } catch (err: any) {
    console.error('[Unhandled Server Error in /api/ads/create]:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' }, 
      { status: 500 }
    );
  }
}
