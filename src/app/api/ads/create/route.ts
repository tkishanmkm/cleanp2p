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

      await admin
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
    } catch (profileUpsertErr) {
      console.warn('Profile auto-ensure warning in /api/ads/create:', profileUpsertErr);
    }

    const formData = await req.json();

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
    if (cleanPayload.payment_window !== undefined) cleanPayload.payment_window = parseInt(String(cleanPayload.payment_window), 10) || 30;
    if (cleanPayload.min_completed_trades !== undefined) cleanPayload.min_completed_trades = parseInt(String(cleanPayload.min_completed_trades), 10) || 0;

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

    // Validate min/max and price constraints
    const effectivePrice = cleanPayload.price !== null && cleanPayload.price !== undefined ? cleanPayload.price : (cleanPayload.fixed_rate ? Number(cleanPayload.fixed_rate) : null);
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
    const normalizedPricingType = String(cleanPayload.pricing_type || cleanPayload.rate_type || (cleanPayload.is_fixed === true ? 'FIXED' : 'FLOAT')).trim().toUpperCase();
    if (!['FIXED', 'FLOAT', 'FLOATING', 'MARGIN', 'DYNAMIC'].includes(normalizedPricingType)) {
      return NextResponse.json({ error: 'Unsupported pricing type.', code: 'INVALID_PRICING_TYPE' }, { status: 400 });
    }
    const isFixedPricing = normalizedPricingType === 'FIXED';

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

      if (marketError || !marketRow || !marketRow.price_in_fiat || Number(marketRow.price_in_fiat) <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${rawAsset}/${rawFiat}. Please try again later.` },
          { status: 400 }
        );
      }

      const refPrice = Number(marketRow.price_in_fiat);
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
      const { data: assetWallet, error: walletError } = await supabase
        .from('wallet_assets')
        .select('balance, in_escrow')
        .eq('user_id', user.id)
        .eq('asset_symbol', rawAsset)
        .maybeSingle();

      const walletBalance = Number(assetWallet?.balance);
      const escrowBalance = Number(assetWallet?.in_escrow ?? 0);
      const spendableBalance = walletBalance - escrowBalance;

      if (walletError || !Number.isFinite(walletBalance) || !Number.isFinite(escrowBalance) ||
          spendableBalance <= 0 || spendableBalance < requiredCrypto) {
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
    const targetTable = cleanPayload.table || (cleanPayload.title && cleanPayload.description ? 'ads' : 'p2p_ads');
    delete cleanPayload.table;

    // 8. Execute Authorized Database Insert without service-role escape hatch
    let { data, error: dbError } = await supabase
      .from(targetTable)
      .insert([cleanPayload])
      .select()
      .single();

    // Fallback between 'p2p_ads' and 'ads' if table does not exist
    if (dbError && (dbError.code === '42P01' || dbError.message?.includes('does not exist'))) {
      const altTable = targetTable === 'ads' ? 'p2p_ads' : 'ads';
      const altResult = await supabase
        .from(altTable)
        .insert([cleanPayload])
        .select()
        .single();

      if (!altResult.error) {
        data = altResult.data;
        dbError = null;
      } else {
        dbError = altResult.error;
      }
    }

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
