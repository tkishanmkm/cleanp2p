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

    // Support Bearer token header if provided by frontend
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    // 1. Explicit Auth Check
    let user = null;
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

    if (authError || !user) {
      // Keep provider/session diagnostics in server logs; do not disclose auth internals.
      console.warn('[POST /api/ads/create] Authentication failed:', authError?.message || 'No authenticated user');
      return NextResponse.json(
        { error: 'Unauthorized. Please log in again.' },
        { status: 401 }
      );
    }

    // Platform Guard Check
    try {
      await assertPlatformControlAllowed('new_ad', { userId: user.id });
    } catch (guardErr: any) {
      const statusCode = Number.isInteger(guardErr?.statusCode) &&
        guardErr.statusCode >= 400 && guardErr.statusCode < 500
        ? guardErr.statusCode
        : 403;
      const publicCode = typeof guardErr?.code === 'string' &&
        /^[A-Z0-9_]{1,64}$/.test(guardErr.code)
        ? guardErr.code
        : 'PLATFORM_AD_CREATION_DISABLED';
      console.warn('[POST /api/ads/create] Platform guard denied creation:', publicCode);
      return NextResponse.json(
        { error: 'Creating new advertisements is currently unavailable for this account.', code: publicCode },
        { status: statusCode }
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
        console.error('Profile auto-ensure failed in /api/ads/create:', profileUpsertError);
        return NextResponse.json(
          { error: 'Unable to prepare the account for advertisement creation. Please try again later.' },
          { status: 500 }
        );
      }
    } catch (profileUpsertErr) {
      console.error('Profile auto-ensure failed in /api/ads/create:', profileUpsertErr);
      return NextResponse.json(
        { error: 'Unable to prepare the account for advertisement creation. Please try again later.' },
        { status: 500 }
      );
    }

    let formData: unknown;
    try {
      formData = await req.json();
    } catch {
      return NextResponse.json({ error: 'Request body must contain valid JSON.' }, { status: 400 });
    }
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
      return NextResponse.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
    }

    // Strip client-controlled identity, lifecycle, and administrative fields.
    // The authenticated identity and initial visibility state are set server-side below.
    const strippedFormData = { ...(formData as Record<string, any>) };
    for (const key of [
      'id', 'user_id', 'userId', 'owner_id', 'seller_id', 'creator_id',
      'is_admin', 'admin', 'role', 'verification_status', 'is_verified',
      'status', 'active', 'is_active', 'is_deleted', 'deleted_at',
      'created_at', 'updated_at', 'public_id',
    ]) {
      delete strippedFormData[key];
    }

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

    // 5. Validate boolean fields before normalization. Boolean("false") is true in
    // JavaScript, so coercing arbitrary client values would silently enable flags.
    for (const key of ['is_fixed', 'require_full_name_verified', 'require_verified_users']) {
      if (strippedFormData[key] !== undefined && strippedFormData[key] !== null &&
          typeof strippedFormData[key] !== 'boolean') {
        return NextResponse.json({ error: `${key} must be a boolean.` }, { status: 400 });
      }
    }

    // Sanitize and cast numeric payload fields before database operations.
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
      is_fixed: Boolean(strippedFormData.is_fixed ?? (typeof strippedFormData.fixed_rate === 'boolean' ? strippedFormData.fixed_rate : false)),
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
    if (cleanPayload.payment_window !== undefined && cleanPayload.payment_window !== null && cleanPayload.payment_window !== '') {
      const paymentWindow = Number(cleanPayload.payment_window);
      if (!Number.isSafeInteger(paymentWindow) || paymentWindow < 30 || paymentWindow > 1440) {
        return NextResponse.json(
          { error: 'Payment window must be a whole number between 30 and 1440 minutes.' },
          { status: 400 }
        );
      }
      cleanPayload.payment_window = paymentWindow;
    } else {
      cleanPayload.payment_window = 30;
    }

    if (cleanPayload.min_completed_trades !== undefined && cleanPayload.min_completed_trades !== null && cleanPayload.min_completed_trades !== '') {
      const minCompletedTrades = Number(cleanPayload.min_completed_trades);
      if (!Number.isSafeInteger(minCompletedTrades) || minCompletedTrades < 0 || minCompletedTrades > 1000000) {
        return NextResponse.json(
          { error: 'Minimum completed trades must be a whole number between 0 and 1,000,000.' },
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
    cleanPayload.trade_type = resolvedDirection;
    cleanPayload.type = cleanPayload.type ? String(cleanPayload.type).toUpperCase() : resolvedDirection;

    // Enforce Tier 2 KYC for SELL ads (Tier 1 is blocked from selling)
    if (cleanPayload.type === 'SELL' || resolvedDirection === 'SELL') {
      const admin = getSupabaseAdminClient();
      const { data: creatorProf } = await admin
        .from('profiles')
        .select('is_verified, id_verified, is_id_verified, kyc_status, verification_tier')
        .eq('id', user.id)
        .maybeSingle();

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

    // Validate numeric inputs explicitly; NaN and Infinity must never pass range checks.
    const effectivePrice = cleanPayload.price !== null && cleanPayload.price !== undefined
      ? Number(cleanPayload.price)
      : (typeof cleanPayload.fixed_rate === 'number' || typeof cleanPayload.fixed_rate === 'string')
        ? Number(cleanPayload.fixed_rate)
        : null;
    const numericFields: Array<[string, unknown]> = [
      ['price', effectivePrice],
      ['margin', cleanPayload.margin],
      ['minimum trade limit', cleanPayload.min_amount],
      ['maximum trade limit', cleanPayload.max_amount],
      ['available amount', cleanPayload.available_amount],
      ['total amount', cleanPayload.total_amount],
      ['margin percentage', cleanPayload.margin_percentage],
      ['rate percentage', cleanPayload.rate_percent],
    ];
    for (const [label, rawValue] of numericFields) {
      if (rawValue === null || rawValue === undefined || rawValue === '') continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: `Invalid ${label}; enter a finite number.` }, { status: 400 });
      }
    }
    if (effectivePrice !== null && effectivePrice <= 0) {
      return NextResponse.json({ error: 'Ad price must be greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.min_amount !== undefined && cleanPayload.min_amount <= 0) {
      return NextResponse.json({ error: 'Minimum trade limit must be greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.max_amount !== null && cleanPayload.max_amount !== undefined && cleanPayload.max_amount <= 0) {
      return NextResponse.json({ error: 'Maximum trade limit must be greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.min_amount !== undefined &&
        cleanPayload.max_amount !== null && cleanPayload.max_amount !== undefined &&
        cleanPayload.max_amount < cleanPayload.min_amount) {
      return NextResponse.json({ error: 'Maximum trade limit must be greater than or equal to minimum limit.' }, { status: 400 });
    }

    // Authoritative Server-Side ±50% Reference Market Price Validation
    const isFixedPricing = String(cleanPayload.pricing_type || cleanPayload.rate_type || '').toUpperCase() === 'FIXED' || Boolean(cleanPayload.is_fixed);

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

      const marketReferencePrice = Number(marketRow?.price_in_fiat);
      if (marketError || !marketRow || !Number.isFinite(marketReferencePrice) || marketReferencePrice <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${rawAsset}/${rawFiat}. Please try again later.` },
          { status: 400 }
        );
      }

      const refPrice = marketReferencePrice;
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
      const marginPct = cleanPayload.margin_percentage !== undefined ? Number(cleanPayload.margin_percentage) : 0;
      if (marginPct < -50 || marginPct > 50) {
        return NextResponse.json(
          { error: 'Margin percentage for dynamic pricing must be between -50% and +50%.' },
          { status: 400 }
        );
      }
    }

    // 6. Server-Side SELL Ad Spendable Balance Validation against public.wallet_assets
    if (resolvedDirection === 'SELL') {
      let requiredCrypto = 0;
      if (cleanPayload.available_amount && cleanPayload.available_amount > 0) {
        requiredCrypto = cleanPayload.available_amount;
      } else if (cleanPayload.total_amount && cleanPayload.total_amount > 0) {
        requiredCrypto = cleanPayload.total_amount;
      } else if (cleanPayload.max_amount && effectivePrice && effectivePrice > 0) {
        requiredCrypto = cleanPayload.max_amount / effectivePrice;
      } else if (cleanPayload.min_amount && effectivePrice && effectivePrice > 0) {
        requiredCrypto = cleanPayload.min_amount / effectivePrice;
      }

      // A SELL ad must reserve a known, positive crypto quantity; never permit an
      // under-specified ad to bypass the balance comparison.
      if (!Number.isFinite(requiredCrypto) || requiredCrypto <= 0) {
        return NextResponse.json(
          { error: 'A valid positive crypto amount is required to create a SELL advertisement.', code: 'INVALID_SELL_AMOUNT' },
          { status: 400 }
        );
      }

      // Query the authenticated user's canonical wallet row. Fail closed on query errors
      // and malformed balances instead of coercing them to zero or accepting bad data.
      const { data: assetWallet, error: walletError } = await supabase
        .from('wallet_assets')
        .select('balance, in_escrow')
        .eq('user_id', user.id)
        .eq('asset_symbol', rawAsset)
        .maybeSingle();

      const spendableBalance = Number(assetWallet?.balance);
      const escrowBalance = Number(assetWallet?.in_escrow ?? 0);

      if (
        walletError ||
        !assetWallet ||
        !Number.isFinite(spendableBalance) ||
        spendableBalance < 0 ||
        !Number.isFinite(escrowBalance) ||
        escrowBalance < 0 ||
        spendableBalance < requiredCrypto
      ) {
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

    // 7. Attach authenticated ownership and force a newly-created ad into active state.
    cleanPayload.user_id = user.id;

    // Only allow the two explicitly supported ad tables; never let request data select
    // arbitrary PostgREST tables. Default to the canonical ads table.
    const requestedTable = typeof cleanPayload.table === 'string' ? cleanPayload.table.trim() : '';
    delete cleanPayload.table;
    if (requestedTable && !['ads', 'p2p_ads'].includes(requestedTable)) {
      return NextResponse.json({ error: 'Unsupported advertisement storage target.' }, { status: 400 });
    }
    const targetTable: 'ads' | 'p2p_ads' = requestedTable
      ? requestedTable as 'ads' | 'p2p_ads'
      : 'ads';
    if (targetTable === 'ads') {
      cleanPayload.is_active = true;
    } else {
      cleanPayload.active = true;
      cleanPayload.is_deleted = false;
      cleanPayload.status = 'ACTIVE';
    }

    // 8. Execute Authorized Database Insert without service-role escape hatch
    let { data, error: dbError } = await supabase
      .from(targetTable)
      .insert([cleanPayload])
      .select()
      .single();

    // Do not silently redirect writes to a different table when the requested
    // schema is unavailable; the two ad tables may have different constraints
    // and lifecycle semantics. Surface a generic failure instead.

    // If RLS or authorization denies operation, fail-closed without service role bypass
    if (dbError) {
      console.error('[Database Insert Error in /api/ads/create]:', dbError);
      const isRlsError = dbError.code === '42501' || dbError.message?.toLowerCase().includes('row-level security');
      return NextResponse.json(
        {
          error: isRlsError
            ? 'Access denied: You do not have permission to create this advertisement.'
            : 'Failed to create advertisement. Please review the submitted fields and try again.',
          code: isRlsError ? 'AD_CREATE_FORBIDDEN' : 'AD_CREATE_FAILED',
        },
        { status: isRlsError ? 403 : 400 }
      );
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error('[POST /api/ads/create] Unhandled server error:', err);
    return NextResponse.json(
      { error: 'An unexpected error occurred while creating the advertisement.' },
      { status: 500 }
    );
  }
}
