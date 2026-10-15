import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { isTier2User } from '@/lib/kyc';

export const dynamic = 'force-dynamic';

const VALID_SUPPORTED_ASSETS = ['USDT', 'BTC', 'ETH', 'LTC'];

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    // A supplied Authorization header is authoritative: never fall back to cookie
    // identity when that header is malformed or its bearer token is invalid.
    const authHeader = req.headers.get('authorization');
    const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
    const bearerToken = bearerMatch?.[1]?.trim();

    // 1. Explicit Auth Check
    let user = null;
    let authError: any = null;

    if (authHeader !== null) {
      if (!bearerToken) {
        return NextResponse.json(
          { error: 'Invalid authorization header.', code: 'INVALID_AUTHORIZATION' },
          { status: 401 }
        );
      }
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    } else {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      console.warn('[Auth] Advertisement creation rejected because no valid session was found.');
      return NextResponse.json(
        { error: 'No active session found. Please refresh or log in again.', code: 'UNAUTHENTICATED' },
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

    // Ensure public.profiles record exists for user.id to guarantee foreign key integrity
    try {
      const admin = getSupabaseAdminClient();
      const profileName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Trader';
      const cleanUsername = user.user_metadata?.username || (user.email?.split('@')[0] || 'trader').toLowerCase().replace(/[^a-z0-9_]/g, '_');

      const { error: profileUpsertError } = await admin
        .from('profiles')
        .upsert(
          {
            id: user.id,
            email: user.email,
            username: cleanUsername,
            full_name: profileName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id', ignoreDuplicates: true }
        );
      if (profileUpsertError) {
        console.error('[Profile ensure query failed in /api/ads/create]:', profileUpsertError);
        return NextResponse.json({ error: 'Account profile is temporarily unavailable.', code: 'PROFILE_UNAVAILABLE' }, { status: 503 });
      }
    } catch (profileUpsertErr) {
      console.error('[Profile ensure failed in /api/ads/create]:', profileUpsertErr);
      return NextResponse.json(
        { error: 'Account profile is temporarily unavailable. Please try again.', code: 'PROFILE_UNAVAILABLE' },
        { status: 503 }
      );
    }

    const contentLength = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 32 * 1024) {
      return NextResponse.json(
        { error: 'Advertisement request is too large.', code: 'REQUEST_BODY_TOO_LARGE' },
        { status: 413 }
      );
    }

    let formData: unknown;
    try {
      const rawBody = await req.text();
      if (new TextEncoder().encode(rawBody).byteLength > 32 * 1024) {
        return NextResponse.json(
          { error: 'Advertisement request is too large.', code: 'REQUEST_BODY_TOO_LARGE' },
          { status: 413 }
        );
      }
      formData = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Request body must contain valid JSON.', code: 'INVALID_JSON' },
        { status: 400 }
      );
    }
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      return NextResponse.json(
        { error: 'Request body must be a JSON object.', code: 'INVALID_REQUEST_BODY' },
        { status: 400 }
      );
    }

    // 2. Strip all client-controlled identity and administrative fields to prevent spoofing
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

    // 3. Validate Supported Crypto Asset (USDT, BTC, ETH, LTC)
    const assetInput = strippedFormData.crypto ?? strippedFormData.asset ?? strippedFormData.asset_symbol ?? strippedFormData.crypto_symbol ?? strippedFormData.coin ?? 'USDT';
    if (typeof assetInput !== 'string') {
      return NextResponse.json({ error: 'Crypto asset must be a string.', code: 'INVALID_ASSET' }, { status: 400 });
    }
    const rawAsset = assetInput.toUpperCase().trim();

    if (!VALID_SUPPORTED_ASSETS.includes(rawAsset)) {
      return NextResponse.json(
        { 
          error: `Unsupported cryptocurrency '${rawAsset}'. Supported assets are: ${VALID_SUPPORTED_ASSETS.join(', ')}.` 
        },
        { status: 400 }
      );
    }

    // 4. Validate Supported Fiat Currency
    const fiatInput = strippedFormData.fiatCurrency ?? strippedFormData.fiat ?? strippedFormData.fiat_currency ?? strippedFormData.fiat_symbol ?? strippedFormData.currency ?? 'USD';
    if (typeof fiatInput !== 'string') {
      return NextResponse.json({ error: 'Fiat currency must be a string.', code: 'INVALID_FIAT' }, { status: 400 });
    }
    const rawFiat = fiatInput.toUpperCase().trim();

    const isValidFiat = FIAT_CURRENCIES.some(f => f.code.toUpperCase() === rawFiat);
    if (!isValidFiat) {
      return NextResponse.json(
        { 
          error: `Unsupported fiat currency '${rawFiat}'. Please select a valid supported currency.` 
        },
        { status: 400 }
      );
    }

    // Reject coercible non-numeric JSON values (for example true or []) before Number() can normalize them.
    const numericInputKeys = [
      'price', 'unit_price', 'margin', 'price_margin', 'margin_percentage',
      'min_amount', 'max_amount', 'min_order', 'max_order', 'min_limit', 'max_limit',
      'total_amount', 'available_amount', 'rate_percent', 'rate_adjustment',
      'payment_window', 'min_completed_trades',
    ];
    for (const key of numericInputKeys) {
      const value = strippedFormData[key];
      if (value === undefined || value === null || value === '') continue;
      if ((typeof value !== 'number' && typeof value !== 'string') ||
          (typeof value === 'string' && value.trim() === '') ||
          !Number.isFinite(Number(value))) {
        return NextResponse.json(
          { error: `Field '${key}' must be a finite number.`, code: 'INVALID_NUMERIC_FIELD' },
          { status: 400 }
        );
      }
    }

    // 5. Sanitize and cast boolean/numeric payload fields before database operations
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
      margin: strippedFormData.margin !== undefined && strippedFormData.margin !== null && strippedFormData.margin !== '' ? Number(strippedFormData.margin) : (strippedFormData.price_margin !== undefined && strippedFormData.price_margin !== null && strippedFormData.price_margin !== '' ? Number(strippedFormData.price_margin) : null),
      margin_percentage: strippedFormData.margin_percentage !== undefined && strippedFormData.margin_percentage !== null && strippedFormData.margin_percentage !== '' ? Number(strippedFormData.margin_percentage) : (strippedFormData.margin !== undefined && strippedFormData.margin !== null && strippedFormData.margin !== '' ? Number(strippedFormData.margin) : (strippedFormData.price_margin !== undefined && strippedFormData.price_margin !== null && strippedFormData.price_margin !== '' ? Number(strippedFormData.price_margin) : 0)),
      min_amount: strippedFormData.min_amount !== undefined && strippedFormData.min_amount !== null && strippedFormData.min_amount !== '' ? Number(strippedFormData.min_amount) : (strippedFormData.min_order !== undefined && strippedFormData.min_order !== null && strippedFormData.min_order !== '' ? Number(strippedFormData.min_order) : null),
      max_amount: strippedFormData.max_amount !== undefined && strippedFormData.max_amount !== null && strippedFormData.max_amount !== '' ? Number(strippedFormData.max_amount) : (strippedFormData.max_order !== undefined && strippedFormData.max_order !== null && strippedFormData.max_order !== '' ? Number(strippedFormData.max_order) : null),
      is_fixed: (() => {
        const fixedValue = strippedFormData.is_fixed ?? (typeof strippedFormData.fixed_rate === 'boolean' ? strippedFormData.fixed_rate : false);
        if (typeof fixedValue === 'boolean') return fixedValue;
        if (typeof fixedValue === 'string' && ['true', 'false'].includes(fixedValue.trim().toLowerCase())) {
          return fixedValue.trim().toLowerCase() === 'true';
        }
        return false;
      })(),
    };

    if (typeof cleanPayload.fixed_rate === 'boolean') {
      delete cleanPayload.fixed_rate;
    }

    // Normalize the camelCase API alias and never persist duplicate client field names.
    if (cleanPayload.payment_methods === undefined && strippedFormData.paymentMethods !== undefined) {
      cleanPayload.payment_methods = strippedFormData.paymentMethods;
    }
    delete cleanPayload.paymentMethods;

    if (cleanPayload.min_order !== undefined) cleanPayload.min_order = cleanPayload.min_order ? Number(cleanPayload.min_order) : null;
    if (cleanPayload.max_order !== undefined) cleanPayload.max_order = cleanPayload.max_order ? Number(cleanPayload.max_order) : null;
    if (cleanPayload.total_amount !== undefined) cleanPayload.total_amount = cleanPayload.total_amount ? Number(cleanPayload.total_amount) : null;
    if (cleanPayload.available_amount !== undefined) cleanPayload.available_amount = cleanPayload.available_amount ? Number(cleanPayload.available_amount) : null;
    if (cleanPayload.rate_percent !== undefined) cleanPayload.rate_percent = cleanPayload.rate_percent ? Number(cleanPayload.rate_percent) : 0;
    if (cleanPayload.rate_adjustment !== undefined) cleanPayload.rate_adjustment = cleanPayload.rate_adjustment ? Number(cleanPayload.rate_adjustment) : 0;
    if (cleanPayload.margin_percentage !== undefined) cleanPayload.margin_percentage = cleanPayload.margin_percentage ? Number(cleanPayload.margin_percentage) : 0;
    if (cleanPayload.payment_methods !== undefined) {
      if (!Array.isArray(cleanPayload.payment_methods) || cleanPayload.payment_methods.length < 1 || cleanPayload.payment_methods.length > 20) {
        return NextResponse.json({ error: 'Payment methods must be a list containing 1 to 20 entries.', code: 'INVALID_PAYMENT_METHODS' }, { status: 400 });
      }
      const normalizedPaymentMethods: string[] = [];
      const seenPaymentMethods = new Set<string>();
      for (const method of cleanPayload.payment_methods) {
        if (typeof method !== 'string' || method.trim().length < 1 || method.trim().length > 80) {
          return NextResponse.json({ error: 'Each payment method must be a string between 1 and 80 characters.', code: 'INVALID_PAYMENT_METHODS' }, { status: 400 });
        }
        const displayValue = method.trim();
        const normalizedKey = displayValue.toLowerCase();
        if (!seenPaymentMethods.has(normalizedKey)) {
          seenPaymentMethods.add(normalizedKey);
          normalizedPaymentMethods.push(displayValue);
        }
      }
      if (normalizedPaymentMethods.length === 0) {
        return NextResponse.json({ error: 'At least one valid payment method is required.', code: 'INVALID_PAYMENT_METHODS' }, { status: 400 });
      }
      cleanPayload.payment_methods = normalizedPaymentMethods;
    }

    if (cleanPayload.payment_window !== undefined && cleanPayload.payment_window !== null && cleanPayload.payment_window !== '') {
      const paymentWindow = Number(cleanPayload.payment_window);
      if (!Number.isInteger(paymentWindow) || paymentWindow < 30 || paymentWindow > 1440) {
        return NextResponse.json(
          { error: 'Payment window must be a whole number between 30 and 1440 minutes.', code: 'INVALID_PAYMENT_WINDOW' },
          { status: 400 }
        );
      }
      cleanPayload.payment_window = paymentWindow;
    } else {
      cleanPayload.payment_window = 30;
    }
    if (cleanPayload.min_completed_trades !== undefined && cleanPayload.min_completed_trades !== null && cleanPayload.min_completed_trades !== '') {
      const minCompletedTrades = Number(cleanPayload.min_completed_trades);
      if (!Number.isSafeInteger(minCompletedTrades) || minCompletedTrades < 0) {
        return NextResponse.json(
          { error: 'Minimum completed trades must be a non-negative whole number.', code: 'INVALID_MIN_COMPLETED_TRADES' },
          { status: 400 }
        );
      }
      cleanPayload.min_completed_trades = minCompletedTrades;
    } else {
      cleanPayload.min_completed_trades = 0;
    }

    // Normalize and strictly validate ad trade direction (BUY/SELL)
    const resolvedDirection = resolveTradeType(cleanPayload);
    if (!resolvedDirection) {
      return NextResponse.json(
        { error: 'Invalid or missing ad trade direction (BUY/SELL).' },
        { status: 400 }
      );
    }
    // Keep legacy and canonical direction fields identical; never persist a conflicting client-supplied type.
    cleanPayload.trade_type = resolvedDirection;
    cleanPayload.type = resolvedDirection;

    // Enforce Tier 2 KYC for SELL ads (Tier 1 is blocked from selling)
    if (cleanPayload.type === 'SELL' || resolvedDirection === 'SELL') {
      const admin = getSupabaseAdminClient();
      const { data: creatorProf, error: creatorProfileError } = await admin
        .from('profiles')
        .select('is_verified, id_verified, is_id_verified, kyc_status, verification_tier')
        .eq('id', user.id)
        .maybeSingle();

      if (creatorProfileError || !creatorProf) {
        console.error('[KYC profile lookup failed in /api/ads/create]:', creatorProfileError || 'Profile not found');
        return NextResponse.json(
          { error: 'KYC status is temporarily unavailable. Please try again.', code: 'KYC_STATUS_UNAVAILABLE' },
          { status: 503 }
        );
      }

      const isCreatorTier2 = isTier2User(creatorProf);

      if (!isCreatorTier2) {
        return NextResponse.json(
          {
            error: 'KYC verification is required to sell.',
            code: 'KYC_REQUIRED',
            requires_kyc: true,
          },
          { status: 403 }
        );
      }
    }

    // Validate min/max and price constraints
    let effectivePrice = cleanPayload.price !== null && cleanPayload.price !== undefined ? cleanPayload.price : (cleanPayload.fixed_rate ? Number(cleanPayload.fixed_rate) : null);
    if (effectivePrice !== null && (!Number.isFinite(effectivePrice) || effectivePrice <= 0)) {
      return NextResponse.json({ error: 'Ad price must be a valid number greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.min_amount !== undefined &&
        (!Number.isFinite(cleanPayload.min_amount) || cleanPayload.min_amount <= 0)) {
      return NextResponse.json({ error: 'Minimum trade limit must be a valid number greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.max_amount !== null && cleanPayload.max_amount !== undefined &&
        (!Number.isFinite(cleanPayload.max_amount) || cleanPayload.max_amount <= 0)) {
      return NextResponse.json({ error: 'Maximum trade limit must be a valid number greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.min_amount !== undefined &&
        cleanPayload.max_amount !== null && cleanPayload.max_amount !== undefined &&
        cleanPayload.max_amount < cleanPayload.min_amount) {
      return NextResponse.json({ error: 'Maximum trade limit must be greater than or equal to minimum limit.' }, { status: 400 });
    }

    // Authoritative Server-Side ±50% Reference Market Price Validation
    const explicitPricingType = strippedFormData.pricing_type ?? strippedFormData.rate_type;
    if (explicitPricingType !== undefined && (typeof explicitPricingType !== 'string' || explicitPricingType.trim().length === 0 || explicitPricingType.trim().length > 20)) {
      return NextResponse.json({ error: 'Pricing type must be a non-empty string up to 20 characters.', code: 'INVALID_PRICING_TYPE' }, { status: 400 });
    }
    const normalizedPricingType = String(explicitPricingType ?? (cleanPayload.is_fixed === true ? 'FIXED' : 'FLOAT')).trim().toUpperCase();
    if (!['FIXED', 'FLOAT', 'FLOATING', 'MARGIN', 'DYNAMIC'].includes(normalizedPricingType)) {
      return NextResponse.json({ error: 'Unsupported pricing type.', code: 'INVALID_PRICING_TYPE' }, { status: 400 });
    }
    const isFixedPricing = normalizedPricingType === 'FIXED';
    // Keep persisted legacy boolean semantics aligned with the validated canonical pricing type.
    cleanPayload.is_fixed = isFixedPricing;
    cleanPayload.pricing_type = normalizedPricingType;

    if (isFixedPricing) {
      if (effectivePrice === null || effectivePrice <= 0) {
        return NextResponse.json({ error: 'Valid fixed price is required for fixed-rate ads.' }, { status: 400 });
      }

      const { data: marketRow, error: marketError } = await supabase
        .from('crypto_market_prices')
        .select('price_in_fiat, updated_at')
        .eq('asset_symbol', rawAsset)
        .eq('fiat_symbol', rawFiat)
        .maybeSingle();

      const refPrice = Number(marketRow?.price_in_fiat);
      if (marketError || !marketRow || !Number.isFinite(refPrice) || refPrice <= 0) {
        console.error('[Market price lookup failed in /api/ads/create]:', marketError || 'Missing or invalid reference price');
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${rawAsset}/${rawFiat}. Please try again later.`, code: 'MARKET_PRICE_UNAVAILABLE' },
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
      const marginSource = cleanPayload.margin_percentage !== undefined ? cleanPayload.margin_percentage : cleanPayload.margin;
      const marginPct = marginSource !== undefined && marginSource !== null ? Number(marginSource) : 0;
      if (!Number.isFinite(marginPct) || marginPct < -50 || marginPct > 50) {
        return NextResponse.json(
          { error: 'Margin percentage for dynamic pricing must be between -50% and +50%.' },
          { status: 400 }
        );
      }
      // Derive floating prices on the server; never trust a client-supplied price
      // that could disagree with the validated margin and current market reference.
      const { data: marketRow, error: marketError } = await supabase
        .from('crypto_market_prices')
        .select('price_in_fiat')
        .eq('asset_symbol', rawAsset)
        .eq('fiat_symbol', rawFiat)
        .maybeSingle();
      const referencePrice = Number(marketRow?.price_in_fiat);
      if (marketError || !Number.isFinite(referencePrice) || referencePrice <= 0) {
        console.error('[Floating market price lookup failed in /api/ads/create]:', marketError || 'Missing or invalid reference price');
        return NextResponse.json(
          { error: 'Market reference price is currently unavailable. Please try again later.', code: 'MARKET_PRICE_UNAVAILABLE' },
          { status: 503 }
        );
      }
      effectivePrice = Number((referencePrice * (1 + marginPct / 100)).toFixed(8));
      if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        return NextResponse.json(
          { error: 'Unable to calculate a valid floating price.', code: 'INVALID_FLOATING_PRICE' },
          { status: 400 }
        );
      }
      cleanPayload.price = effectivePrice;
      cleanPayload.unit_price = effectivePrice;
    }

    // 6. Server-Side SELL Ad Spendable Balance Validation against public.wallet_assets.
    // min_amount/max_amount are fiat limits; total_amount/available_amount are crypto quantities.
    if (resolvedDirection === 'SELL') {
      const maxFiatAmount = Number(cleanPayload.max_amount);
      if (!Number.isFinite(maxFiatAmount) || maxFiatAmount <= 0 ||
          !Number.isFinite(effectivePrice) || effectivePrice <= 0) {
        return NextResponse.json(
          { error: 'A valid maximum fiat limit and unit price are required for SELL advertisements.', code: 'INVALID_SELL_AMOUNT' },
          { status: 400 }
        );
      }

      const requiredCrypto = maxFiatAmount / effectivePrice;
      if (!Number.isFinite(requiredCrypto) || requiredCrypto <= 0) {
        return NextResponse.json(
          { error: 'Unable to calculate the crypto quantity for this advertisement.', code: 'INVALID_SELL_AMOUNT' },
          { status: 400 }
        );
      }
      cleanPayload.total_amount = requiredCrypto;
      cleanPayload.available_amount = requiredCrypto;

      // Query authoritative balance and subtract funds already committed to escrow.
      // Use the server-side client for the authoritative balance read because
      // user-facing RLS may hide wallet rows; scope the privileged query to this user.
      const balanceClient = getSupabaseAdminClient();
      const { data: assetWallet, error: walletError } = await balanceClient
        .from('wallet_assets')
        .select('balance, in_escrow')
        .eq('user_id', user.id)
        .eq('asset_symbol', rawAsset)
        .maybeSingle();

      const walletBalance = Number(assetWallet?.balance);
      const escrowBalance = Number(assetWallet?.in_escrow ?? 0);
      const spendableBalance = walletBalance - escrowBalance;

      if (walletError) {
        console.error('[Wallet balance lookup failed in /api/ads/create]:', walletError);
        return NextResponse.json(
          { error: 'Wallet balance is temporarily unavailable. Please try again.', code: 'WALLET_BALANCE_UNAVAILABLE' },
          { status: 503 }
        );
      }

      if (!Number.isFinite(walletBalance) || !Number.isFinite(escrowBalance)) {
        return NextResponse.json(
          { error: 'Wallet balance data is invalid; advertisement cannot be created.', code: 'INVALID_WALLET_BALANCE' },
          { status: 503 }
        );
      }

      if (spendableBalance <= 0 || spendableBalance < requiredCrypto) {
        return NextResponse.json(
          {
            error: `Insufficient spendable balance in your ${rawAsset} wallet. You have ${spendableBalance.toFixed(8)} ${rawAsset} available, but require at least ${requiredCrypto.toFixed(8)} ${rawAsset} to post this SELL advertisement.`,
            code: 'INSUFFICIENT_SPENDABLE_BALANCE',
            required: requiredCrypto,
            available: spendableBalance,
            asset: rawAsset,
          },
          { status: 400 }
        );
      }
    }

    // 7. Attach strictly authenticated server user_id
    cleanPayload.user_id = user.id;

    // Determine target table
    // This endpoint creates canonical marketplace ads only. Never allow a client
    // field to select an arbitrary Supabase table or fall back to the legacy table.
    const targetTable = 'ads';
    delete cleanPayload.table;

    // 8. Execute Authorized Database Insert without service-role escape hatch
    let { data, error: dbError } = await supabase
      .from(targetTable)
      .insert([cleanPayload])
      .select()
      .single();

    // Canonical ads-table failures fail closed; no legacy-table fallback.

    // If RLS or authorization denies operation, fail-closed without service role bypass
    if (dbError) {
      console.error('[Database Insert Error in /api/ads/create]:', dbError);
      const isRlsError = dbError.code === '42501' || dbError.message?.toLowerCase().includes('row-level security');
      return NextResponse.json(
        {
          error: isRlsError
            ? 'Access denied: You do not have permission to create this advertisement.'
            : 'Unable to create advertisement. Please review the submitted fields or try again later.',
          code: isRlsError ? 'ADVERTISEMENT_ACCESS_DENIED' : 'AD_CREATION_FAILED'
        },
        { status: isRlsError ? 403 : 500 }
      );
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error('[Unhandled Server Error in /api/ads/create]:', err);
    return NextResponse.json(
      { error: 'Unable to create advertisement at this time.', code: 'AD_CREATION_FAILED' },
      { status: 500 }
    );
  }
}
