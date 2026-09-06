import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

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

    // Support Bearer token header if provided by frontend
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    // 1. Authenticate user session
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
      return NextResponse.json({ error: 'No active session found!' }, { status: 401 });
    }

    const body = await request.json();
    const coinType = (body.coin || body.crypto || body.crypto_currency || 'USDT').toUpperCase();
    const adSide = (body.side || body.type || body.adType || 'BUY').toUpperCase();

    // 2. Check user's actual available wallet balance for this coin
    let userBalance = 0;
    try {
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .ilike('asset_symbol', coinType)
        .maybeSingle();

      if (wallet) {
        userBalance = Number(
          wallet.available_balance ??
          wallet.available ??
          wallet.main_balance ??
          wallet.balance ??
          0
        );
        if (wallet.locked_balance && !wallet.available_balance && !wallet.available && !wallet.main_balance) {
          userBalance = Math.max(0, userBalance - Number(wallet.locked_balance));
        }
      } else {
        // Fallback: check wallets and wallet_assets directly if user_wallets view has no row
        const { data: directWallets } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', user.id);

        if (directWallets && directWallets.length > 0) {
          const walletIds = directWallets.map(w => w.id);
          const { data: wa } = await supabase
            .from('wallet_assets')
            .select('available, balance, locked_escrow, locked_withdrawal')
            .in('wallet_id', walletIds)
            .ilike('asset_code', coinType)
            .maybeSingle();

          if (wa) {
            userBalance = Number(wa.available ?? (Number(wa.balance || 0) - Number(wa.locked_escrow || 0) - Number(wa.locked_withdrawal || 0)));
          }
        }
      }
    } catch (balErr) {
      console.warn('Balance lookup warning:', balErr);
    }

    // If user has 0 balance and it's a SELL ad, handle accordingly:
    // Option A: Block ad creation completely if balance is 0
    if (adSide === 'SELL' && userBalance <= 0) {
      return NextResponse.json(
        { error: 'Insufficient balance to create a sell advertisement.' },
        { status: 400 }
      );
    }

    // 3. Automatically adjust limits based on user's actual balance
    let requestedMax = Number(body.max_amount || body.max_limit || 0);
    let requestedMin = Number(body.min_amount || body.min_limit || 0);

    if (adSide === 'SELL') {
      // If the user's max limit exceeds their actual wallet balance, cap it automatically
      if (requestedMax > userBalance || !requestedMax) {
        requestedMax = userBalance;
      }
      // If min amount exceeds available balance, adjust min amount as well
      if (requestedMin > userBalance) {
        requestedMin = userBalance;
      }
    }

    // Sanitize and prepare clean payload (preventing PostgreSQL 22P02 errors)
    const cleanPayload: Record<string, any> = {
      ...body,
      user_id: user.id,
      type: adSide,
      coin: coinType,
      price: body.price !== undefined && body.price !== null && body.price !== '' ? Number(body.price) : null,
      margin: body.margin !== undefined && body.margin !== null && body.margin !== '' ? Number(body.margin) : (body.price_margin ? Number(body.price_margin) : null),
      min_amount: requestedMin,
      min_limit: requestedMin,
      max_amount: requestedMax,
      max_limit: requestedMax,
      is_fixed: Boolean(body.is_fixed ?? (typeof body.fixed_rate === 'boolean' ? body.fixed_rate : false)),
      require_full_name_verified: Boolean(body.require_full_name_verified),
      require_verified_users: Boolean(body.require_verified_users),
    };

    if (typeof cleanPayload.fixed_rate === 'boolean') {
      delete cleanPayload.fixed_rate;
    }
    if (cleanPayload.payment_window !== undefined) {
      cleanPayload.payment_window = parseInt(String(cleanPayload.payment_window), 10) || 30;
    }
    if (cleanPayload.min_completed_trades !== undefined) {
      cleanPayload.min_completed_trades = parseInt(String(cleanPayload.min_completed_trades), 10) || 0;
    }

    const targetTable = cleanPayload.table || (cleanPayload.title && cleanPayload.description ? 'ads' : 'p2p_ads');
    delete cleanPayload.table;

    // 4. Insert the ad with the sanitized and capped limits
    let { data, error: dbError } = await supabase
      .from(targetTable)
      .insert([cleanPayload])
      .select()
      .single();

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

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('Unhandled ad creation error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
