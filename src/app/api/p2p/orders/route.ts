import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { calculateMinimumFiatAmount, BASE_PLATFORM_USD_MINIMUM } from '@/lib/currency';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);

    const asset = searchParams.get('asset') || 'USDT';
    const type = searchParams.get('type'); // Optional filter: 'BUY' or 'SELL'

    let query = supabase
      .from('p2p_orders')
      .select('*')
      .eq('status', 'ACTIVE')
      .gt('available_amount', 0)
      .order('price_per_unit', { ascending: true });

    if (asset) {
      query = query.eq('asset_symbol', asset.toUpperCase());
    }
    if (type) {
      query = query.eq('order_type', type.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, orders: data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    let supabase = await createClient();

    // 1. Authenticate User from Server Client Cookie Session
    let {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    // 2. Fallback: Check Bearer token from header if cookie user isn't found
    if (!user) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        const adminClient = getSupabaseAdminClient();
        const { data: headerUserResult } = await adminClient.auth.getUser(token);
        if (headerUserResult?.user) {
          user = headerUserResult.user;
          authError = null;
          supabase = adminClient as any;
        } else {
          // Also try with standard client instance if token was passed
          const { data: fallbackUserRes } = await supabase.auth.getUser(token);
          if (fallbackUserRes?.user) {
            user = fallbackUserRes.user;
            authError = null;
          }
        }
      }
    }

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'You must login. Active browser session not found.',
          debugInfo: {
            authErrorMessage: authError?.message || 'No active session token detected by server client',
            totalCookiesReceived: allCookies.length,
            cookieKeysPresent: allCookies.map((c) => c.name),
            hasSupabaseCookie: allCookies.some((c) => c.name.includes('auth-token') || c.name.includes('supabase') || c.name.includes('sb-')),
          },
        },
        { status: 401 }
      );
    }

    // 2. Parse Payload & Continue Order Creation...
    const body = await request.json();
    const {
      orderType,
      assetSymbol,
      fiatCurrency,
      pricePerUnit,
      minLimit,
      maxLimit,
      paymentMethods,
    } = body;

    const price = Number(pricePerUnit);
    const min = Number(minLimit);
    const max = Number(maxLimit);
    const totalAmount = Number(body.totalAmount) || (price > 0 ? max / price : 1000);

    if (!orderType || !assetSymbol || !price || !min || !max) {
      return NextResponse.json(
        { success: false, error: 'Missing required order fields (orderType, assetSymbol, pricePerUnit, minLimit, maxLimit)' },
        { status: 400 }
      );
    }

    const fiat = fiatCurrency ? String(fiatCurrency).toUpperCase() : 'USD';
    const dynamicMin = calculateMinimumFiatAmount(BASE_PLATFORM_USD_MINIMUM, fiat);
    if (min < dynamicMin) {
      return NextResponse.json(
        { success: false, error: `Minimum limit cannot be less than ${dynamicMin} ${fiat} (equivalent to $${BASE_PLATFORM_USD_MINIMUM} USD)` },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('p2p_orders')
      .insert({
        user_id: user.id,
        order_type: String(orderType).toUpperCase(),
        asset_symbol: String(assetSymbol).toUpperCase(),
        fiat_currency: fiatCurrency ? String(fiatCurrency).toUpperCase() : 'USD',
        price_per_unit: price,
        total_amount: totalAmount,
        available_amount: totalAmount,
        min_limit: min,
        max_limit: max,
        payment_methods: paymentMethods || [],
        status: 'ACTIVE',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, order: data });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
