import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';
import { generateAdId } from '@/lib/id-generator';
import { calculateMinimumFiatAmount } from '@/lib/currency';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import { isTier2User } from '@/lib/kyc';
import { resolveTradeType } from '@/utils/p2p-helpers';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { resolveAuthoritativeAdQuote } from '@/lib/p2p/authoritativeAdQuote';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const body = await request.json();

    // Support Bearer token header if provided by frontend
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

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
      console.warn('Profile auto-ensure warning:', profileUpsertErr);
    }

    const coinType = (body.coin || body.crypto || body.crypto_currency || body.asset_symbol || body.asset || 'USDT').toUpperCase();
    const fiatType = (body.fiat || body.fiat_currency || body.fiat_symbol || 'USD').toUpperCase();
    const adSide = resolveTradeType(body);

    const supportedAssets = new Set(['USDT', 'BTC', 'ETH', 'LTC']);
    if (!supportedAssets.has(coinType)) {
      return NextResponse.json({ error: 'Unsupported cryptocurrency. Supported assets are USDT, BTC, ETH, and LTC.' }, { status: 400 });
    }

    if (!FIAT_CURRENCIES.some((currency) => currency.code.toUpperCase() === fiatType)) {
      return NextResponse.json({ error: 'Unsupported fiat currency.' }, { status: 400 });
    }

    if (!adSide) {
      return NextResponse.json(
        { error: 'Invalid or missing ad trade direction (BUY/SELL).' },
        { status: 400 }
      );
    }

    // Selling offers require Tier 2 identity verification. Fail closed if profile state cannot be read.
    if (adSide === 'SELL') {
      const admin = getSupabaseAdminClient();
      const { data: creatorProfile, error: creatorProfileError } = await admin
        .from('profiles')
        .select('is_verified, id_verified, is_id_verified, kyc_status, verification_tier')
        .eq('id', user.id)
        .maybeSingle();

      if (creatorProfileError || !creatorProfile) {
        return NextResponse.json({ error: 'Unable to verify seller eligibility. Please try again.' }, { status: 503 });
      }

      if (!isTier2User(creatorProfile)) {
        return NextResponse.json(
          { error: 'KYC verification is required to sell.', code: 'KYC_REQUIRED', requires_kyc: true },
          { status: 403 }
        );
      }
    }

    const requestedMax = Number(body.max_amount ?? body.max_limit ?? body.maxAmount ?? 5000);
    const requestedMin = Number(body.min_amount ?? body.min_limit ?? body.minAmount ?? 100);

    if (!Number.isFinite(requestedMin) || requestedMin <= 0 ||
        !Number.isFinite(requestedMax) || requestedMax <= 0 || requestedMax < requestedMin) {
      return NextResponse.json({ error: 'Minimum and maximum trade limits must be finite positive numbers, with maximum >= minimum.' }, { status: 400 });
    }

    // Enforce dynamic minimum limit equivalent to at least $10.00 USD.
    const dynamicMinThreshold = calculateMinimumFiatAmount(10.00, fiatType);
    if (requestedMin < dynamicMinThreshold) {
      return NextResponse.json({
        error: `Minimum trade limit must be at least ${dynamicMinThreshold} ${fiatType} (equivalent to $10.00 USD).`,
        code: 'MIN_LIMIT_TOO_LOW',
      }, { status: 400 });
    }

    const priceVal = body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : null;
    const marginVal = Number(body.margin ?? body.rate_percent ?? body.margin_percentage ?? body.price_margin ?? 0);
    const pricingType = String(body.pricing_type || (body.rate_type === 'fixed' || body.is_fixed ? 'FIXED' : 'FLOAT')).toUpperCase();
    const paymentWindow = Math.max(30, parseInt(String(body.payment_window || body.payment_window_minutes || 30), 10) || 30);
    const paymentMethods = Array.isArray(body.payment_methods) && body.payment_methods.length > 0
      ? body.payment_methods
      : (Array.isArray(body.paymentMethods) ? body.paymentMethods : ['Bank Transfer']);

    const isFixedPricing = pricingType === 'FIXED' || body.rate_type === 'fixed' || Boolean(body.is_fixed);

    if (isFixedPricing) {
      if (priceVal === null || !Number.isFinite(priceVal) || priceVal <= 0) {
        return NextResponse.json({ error: 'Valid fixed price is required for fixed-rate ads.' }, { status: 400 });
      }

      const adminClient = getSupabaseAdminClient();
      const { data: marketRow, error: marketError } = await adminClient
        .from('crypto_market_prices')
        .select('price_in_fiat, updated_at')
        .eq('asset_symbol', coinType)
        .eq('fiat_symbol', fiatType)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const refPrice = Number(marketRow?.price_in_fiat);
      if (marketError || !marketRow || !Number.isFinite(refPrice) || refPrice <= 0) {
        return NextResponse.json(
          { error: `Market reference price is currently unavailable for ${coinType}/${fiatType}. Please try again later.` },
          { status: 503 }
        );
      }

      const minAllowedPrice = refPrice * 0.50;
      const maxAllowedPrice = refPrice * 1.50;
      if (priceVal < minAllowedPrice || priceVal > maxAllowedPrice) {
        return NextResponse.json(
          { error: `Fixed price must be within ±50% of the reference market price (${minAllowedPrice.toFixed(2)} - ${maxAllowedPrice.toFixed(2)} ${fiatType}).` },
          { status: 400 }
        );
      }
    } else if (!Number.isFinite(marginVal) || marginVal < -50 || marginVal > 50) {
      return NextResponse.json(
        { error: 'Margin percentage for dynamic pricing must be a finite number between -50% and +50%.' },
        { status: 400 }
      );
    }

    const adQuote = await resolveAuthoritativeAdQuote({
      asset_symbol: coinType,
      fiat_currency: fiatType,
      pricing_type: pricingType,
      is_fixed: isFixedPricing,
      price: priceVal,
      margin: marginVal,
      rate_percent: marginVal,
    });
    if (!adQuote) {
      return NextResponse.json({ error: 'Unable to resolve a valid current advertisement price.' }, { status: 503 });
    }

    // SELL ads must be backed by the canonical wallet_assets balance used by the escrow RPC.
    // Do not use stale legacy tables or profile balance fields as a fallback.
    if (adSide === 'SELL') {
      const adminClient = getSupabaseAdminClient();
      const { data: walletAsset, error: walletError } = await adminClient
        .from('wallet_assets')
        .select('asset_symbol, balance')
        .eq('user_id', user.id)
        .ilike('asset_symbol', coinType)
        .maybeSingle();

      if (walletError) {
        console.error('[P2P Ad Creation] Canonical wallet balance lookup failed:', walletError.code || 'UNKNOWN');
        return NextResponse.json({ error: 'Unable to verify available wallet balance. Please try again.' }, { status: 503 });
      }

      const availableBalance = Number(walletAsset?.balance ?? 0);
      const maxCoinRequired = requestedMax / adQuote.price;
      if (!Number.isFinite(availableBalance) || !Number.isFinite(maxCoinRequired) || availableBalance < maxCoinRequired) {
        return NextResponse.json({
          error: `Insufficient ${coinType} balance to back this sell offer.`,
          code: 'INSUFFICIENT_BALANCE',
        }, { status: 400 });
      }
    }

    const uniqueAdId = generateAdId();

    const resolvedTerms = body.terms || body.terms_conditions || body.termsAndConditions || '';
    const resolvedLabel = body.offer_label || body.label || body.offerLabel || '';
    const resolvedTags = Array.isArray(body.ad_tags) ? body.ad_tags : (Array.isArray(body.tags) ? body.tags : []);

    // Standard base table payload for `public.ads` and `public.p2p_ads`
    const basePayload: Record<string, any> = {
      ad_id: uniqueAdId,
      public_id: uniqueAdId,
      user_id: user.id,
      type: adSide,
      trade_type: adSide,
      asset_symbol: coinType,
      fiat_symbol: fiatType,
      price: priceVal,
      unit_price: priceVal,
      pricing_type: pricingType,
      margin: marginVal,
      min_limit: requestedMin,
      max_limit: requestedMax,
      total_amount: Number((requestedMax / adQuote.price).toFixed(8)),
      available_amount: Number((requestedMax / adQuote.price).toFixed(8)),
      payment_methods: paymentMethods,
      payment_window: paymentWindow,
      
      // Mapped fields for both schema naming conventions
      terms: resolvedTerms,
      offer_label: resolvedLabel,
      label: resolvedLabel,
      ad_tags: resolvedTags,
      tags: resolvedTags,
      auto_reply: body.auto_reply || body.autoReply || '',
      
      is_active: true,
      active: true,
      status: 'active',
      // Include common aliases to satisfy any schema variations
      coin: coinType,
      crypto: coinType,
      fiat: fiatType,
      fiat_currency: fiatType,
      min_amount: requestedMin,
      max_amount: requestedMax,
      rate_percent: marginVal,
      is_fixed: pricingType === 'FIXED',
    };

    // 2. Insert into `ads` table first using the user's authenticated Supabase client
    let data: any = null;
    let dbError: any = null;

    const { data: insertResult, error: insertError } = await supabase
      .from('ads')
      .insert([basePayload])
      .select()
      .single();

    if (!insertError) {
      data = insertResult;
    } else {
      dbError = insertError;
      console.warn('Initial insert into `ads` failed:', insertError.message);

      // Check if error is due to an unknown column in `ads` (code PGRST204 or 42703)
      // Attempt simplified canonical payload
      if (insertError.code === 'PGRST204' || insertError.message?.includes('schema cache') || insertError.message?.includes('column')) {
        const minimalPayload: Record<string, any> = {
          user_id: user.id,
          type: adSide,
          asset_symbol: coinType,
          fiat_symbol: fiatType,
          price: priceVal,
          min_limit: requestedMin,
          max_limit: requestedMax,
          payment_methods: paymentMethods,
          is_active: true,
          terms: resolvedTerms,
          offer_label: resolvedLabel,
          label: resolvedLabel,
          ad_tags: resolvedTags,
          tags: resolvedTags,
        };

        const { data: minResult, error: minError } = await supabase
          .from('ads')
          .insert([minimalPayload])
          .select()
          .single();

        if (!minError) {
          data = minResult;
          dbError = null;
        } else {
          dbError = minError;
        }
      }

      // If RLS blocked the user or table not accessible via client, try service role admin client
      if (dbError && (dbError.code === '42501' || dbError.message?.toLowerCase().includes('row-level security') || dbError.code === '42P01')) {
        try {
          const admin = getSupabaseAdminClient();
          const { data: adminResult, error: adminError } = await admin
            .from('ads')
            .insert([basePayload])
            .select()
            .single();

          if (!adminError) {
            data = adminResult;
            dbError = null;
          } else {
            // Try minimal payload with admin
            const minAdminPayload: Record<string, any> = {
              user_id: user.id,
              type: adSide,
              asset_symbol: coinType,
              fiat_symbol: fiatType,
              price: priceVal,
              min_limit: requestedMin,
              max_limit: requestedMax,
              payment_methods: paymentMethods,
              is_active: true,
              terms: resolvedTerms,
              offer_label: resolvedLabel,
              label: resolvedLabel,
              ad_tags: resolvedTags,
              tags: resolvedTags,
            };
            const { data: minAdminRes, error: minAdminErr } = await admin
              .from('ads')
              .insert([minAdminPayload])
              .select()
              .single();

            if (!minAdminErr) {
              data = minAdminRes;
              dbError = null;
            } else {
              dbError = minAdminErr;
            }
          }
        } catch (adminEx: any) {
          console.error('Admin insertion exception:', adminEx);
        }
      }
    }

    if (dbError) {
      console.error('[P2P Ad Creation Error]:', dbError);
      return NextResponse.json(
        { 
          error: dbError.message || 'Database error creating ad', 
          realError: `${dbError.message} (Code: ${dbError.code || 'UNKNOWN'}${dbError.details ? ` - ${dbError.details}` : ''})`,
          code: dbError.code,
          details: dbError.details,
          hint: dbError.hint
        }, 
        { status: 400 }
      );
    }

    if (data) {
      try {
        const admin = getSupabaseAdminClient();
        const p2pRow = {
          ...basePayload,
          id: data.id || basePayload.id,
          public_ad_id: uniqueAdId,
          crypto: coinType,
          fiat_currency: fiatType,
          ad_type: adSide.toLowerCase(),
          trade_type: adSide,
          unit_price: priceVal,
          status: 'ACTIVE',
        };
        await admin.from('p2p_ads').upsert(p2pRow, { onConflict: 'id', ignoreDuplicates: true });
      } catch (p2pSyncErr) {
        // Silently continue if p2p_ads is a view or non-updatable
      }
    }

    return NextResponse.json({ success: true, data });
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
