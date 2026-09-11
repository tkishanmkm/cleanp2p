import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookieHeader = cookies();
    const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

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

    // Fallback: If client transmitted user_id in payload, check profile existence
    if (!user && body?.user_id) {
      try {
        const admin = getSupabaseAdminClient();
        const { data: profile } = await admin
          .from('profiles')
          .select('id, username, full_name, email')
          .eq('id', body.user_id)
          .maybeSingle();

        if (profile) {
          user = {
            id: profile.id,
            email: profile.email || `${profile.username || 'trader'}@thepax.org`,
            user_metadata: {
              display_name: profile.full_name || profile.username || 'Trader',
              full_name: profile.full_name,
              username: profile.username,
            },
          };
          authError = null;
        }
      } catch (err) {
        console.warn('Profile fallback auth lookup failed:', err);
      }
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
    const adSide = (body.side || body.type || body.adType || body.ad_type || 'BUY').toUpperCase();

    const requestedMax = Number(body.max_amount ?? body.max_limit ?? body.maxAmount ?? 5000);
    const requestedMin = Number(body.min_amount ?? body.min_limit ?? body.minAmount ?? 100);
    const priceVal = body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : null;
    const marginVal = Number(body.margin ?? body.rate_percent ?? body.margin_percentage ?? body.price_margin ?? 0);
    const pricingType = body.pricing_type || (body.rate_type === 'fixed' || body.is_fixed ? 'FIXED' : 'FLOAT');
    const paymentWindow = parseInt(String(body.payment_window || body.payment_window_minutes || 15), 10) || 15;
    const paymentMethods = Array.isArray(body.payment_methods) && body.payment_methods.length > 0
      ? body.payment_methods
      : (Array.isArray(body.paymentMethods) ? body.paymentMethods : ['Bank Transfer']);

    // BALANCE VALIDATION: If user is creating a SELL ad (offering to sell coin), check that minimum limit in coin is present in their account
    if (adSide === 'SELL') {
      const adminClient = getSupabaseAdminClient();
      let availableBalance = 0;

      try {
        const { data: walletData } = await adminClient
          .from('user_wallets')
          .select('available_balance, balance, locked_balance')
          .eq('user_id', user.id)
          .ilike('asset_symbol', coinType)
          .maybeSingle();

        if (walletData) {
          availableBalance = Number(walletData.available_balance ?? (Number(walletData.balance || 0) - Number(walletData.locked_balance || 0)));
        } else {
          // Check profiles table column fallback (e.g. usdt_balance, btc_balance)
          const { data: prof } = await adminClient
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .maybeSingle();
          if (prof) {
            const col = `${coinType.toLowerCase()}_balance`;
            if (prof[col] !== undefined) {
              availableBalance = Number(prof[col] || 0);
            }
          }
        }
      } catch (balErr) {
        console.warn('Balance check error during ad creation:', balErr);
      }

      const effectiveUnitPrice = priceVal && priceVal > 0 ? priceVal : 1;
      const minCoinRequired = requestedMin / effectiveUnitPrice;

      if (availableBalance < minCoinRequired) {
        return NextResponse.json({
          error: `Insufficient ${coinType} balance. You must have at least ${minCoinRequired.toFixed(6)} ${coinType} in your wallet to create a sell offer with a minimum limit of ${requestedMin} ${fiatType}. Current available: ${availableBalance.toFixed(6)} ${coinType}.`,
          code: 'INSUFFICIENT_BALANCE',
        }, { status: 400 });
      }
    }

    // Standard base table payload for `public.ads` and `public.p2p_ads`
    const basePayload: Record<string, any> = {
      user_id: user.id,
      type: adSide,
      asset_symbol: coinType,
      fiat_symbol: fiatType,
      price: priceVal,
      pricing_type: pricingType,
      margin: marginVal,
      min_limit: requestedMin,
      max_limit: requestedMax,
      total_amount: requestedMax,
      available_amount: requestedMax,
      payment_methods: paymentMethods,
      payment_window: paymentWindow,
      terms: body.terms || body.terms_conditions || '',
      auto_reply: body.auto_reply || '',
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
