import { NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { FIAT_CURRENCIES } from '@/lib/currencies';

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
      console.error('[Auth Error Details in /api/ads/create]:', authError?.message);
      return NextResponse.json(
        { 
          error: 'No active session found! Please refresh or log in again.', 
          details: authError?.message 
        }, 
        { status: 401 }
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

    // Validate min/max and price constraints
    const effectivePrice = cleanPayload.price !== null && cleanPayload.price !== undefined ? cleanPayload.price : (cleanPayload.fixed_rate ? Number(cleanPayload.fixed_rate) : null);
    if (effectivePrice !== null && effectivePrice <= 0) {
      return NextResponse.json({ error: 'Ad price must be greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.min_amount <= 0) {
      return NextResponse.json({ error: 'Minimum trade limit must be greater than 0.' }, { status: 400 });
    }
    if (cleanPayload.min_amount !== null && cleanPayload.max_amount !== null && cleanPayload.max_amount < cleanPayload.min_amount) {
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

      // Query authoritative spendable balance from public.wallet_assets
      const { data: assetWallet, error: walletError } = await supabase
        .from('wallet_assets')
        .select('balance, in_escrow')
        .eq('user_id', user.id)
        .eq('asset_symbol', rawAsset)
        .maybeSingle();

      const spendableBalance = Number(assetWallet?.balance || 0);

      if (walletError || spendableBalance <= 0 || (requiredCrypto > 0 && spendableBalance < requiredCrypto)) {
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
          error: isRlsError ? 'Access denied: You do not have permission to create this advertisement.' : 'Failed to create ad in database.', 
          code: dbError.code,
          details: dbError.message 
        }, 
        { status: isRlsError ? 403 : 400 }
      );
    }

    return NextResponse.json({ success: true, data });

  } catch (err: any) {
    console.error('[Unhandled Server Error in /api/ads/create]:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' }, 
      { status: 500 }
    );
  }
}
