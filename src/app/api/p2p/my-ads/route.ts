import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = getSupabaseAdminClient();

    let ads: any[] = [];
    let queryError: any = null;

    // 1. Try querying p2p_ads view
    const { data: viewAds, error: viewError } = await supabase
      .from('p2p_ads')
      .select('*')
      .eq('user_id', user.id)
      .neq('status', 'DELETED')
      .order('created_at', { ascending: false });

    if (!viewError && Array.isArray(viewAds)) {
      ads = viewAds;
    } else {
      queryError = viewError;

      // 2. Try querying ads base table
      const { data: tableAds, error: tableError } = await supabase
        .from('ads')
        .select('*')
        .eq('user_id', user.id)
        .neq('status', 'DELETED')
        .order('created_at', { ascending: false });

      if (!tableError && Array.isArray(tableAds)) {
        ads = tableAds;
        queryError = null;
      } else {
        queryError = tableError;
      }
    }

    // 3. Fallback to admin client if RLS is preventing read
    if (ads.length === 0) {
      try {
        const { data: adminAds, error: adminErr } = await admin
          .from('ads')
          .select('*')
          .eq('user_id', user.id)
          .neq('status', 'DELETED')
          .order('created_at', { ascending: false });

        if (!adminErr && Array.isArray(adminAds) && adminAds.length > 0) {
          ads = adminAds;
          queryError = null;
        }
      } catch (adminEx) {
        console.warn('Admin fallback in my-ads failed:', adminEx);
      }
    }

    // Fetch user balances to compute live available crypto for each ad
    const balances: Record<string, number> = {
      BTC: 0,
      ETH: 0,
      USDT: 0,
      LTC: 0,
    };

    try {
      const [
        { data: walletAssets },
        { data: userWallets },
        { data: chainWallets },
        { data: profile }
      ] = await Promise.all([
        admin.from('wallet_assets').select('*').eq('user_id', user.id),
        admin.from('user_wallets').select('*').eq('user_id', user.id),
        admin.from('wallets').select('*').eq('user_id', user.id),
        admin.from('profiles').select('btc_balance, eth_balance, usdt_balance, ltc_balance').eq('id', user.id).maybeSingle(),
      ]);

      if (profile) {
        if (profile.btc_balance) balances.BTC = Math.max(balances.BTC, Number(profile.btc_balance));
        if (profile.eth_balance) balances.ETH = Math.max(balances.ETH, Number(profile.eth_balance));
        if (profile.usdt_balance) balances.USDT = Math.max(balances.USDT, Number(profile.usdt_balance));
        if (profile.ltc_balance) balances.LTC = Math.max(balances.LTC, Number(profile.ltc_balance));
      }

      if (walletAssets && Array.isArray(walletAssets)) {
        walletAssets.forEach((wa: any) => {
          const sym = String(wa.asset_symbol || wa.asset_code || wa.symbol || wa.crypto || '').toUpperCase();
          const avail = Number(wa.available ?? wa.balance ?? 0) - Number(wa.locked_escrow ?? wa.locked_balance ?? 0);
          if (sym && !isNaN(avail)) {
            balances[sym] = Math.max(balances[sym] || 0, Math.max(0, avail));
          }
        });
      }

      if (userWallets && Array.isArray(userWallets)) {
        userWallets.forEach((w: any) => {
          const sym = String(w.asset_symbol || '').toUpperCase();
          const avail = Number(w.available_balance ?? (Number(w.balance || 0) - Number(w.locked_balance || 0)));
          if (sym && !isNaN(avail)) {
            balances[sym] = Math.max(balances[sym] || 0, Math.max(0, avail));
          }
        });
      }

      if (chainWallets && Array.isArray(chainWallets)) {
        chainWallets.forEach((cw: any) => {
          const sym = String(cw.currency || cw.chain || '').toUpperCase();
          const avail = Number(cw.available_balance ?? cw.balance ?? 0);
          if (sym && !isNaN(avail)) {
            balances[sym] = Math.max(balances[sym] || 0, Math.max(0, avail));
          }
        });
      }
    } catch (balErr) {
      console.warn('Failed to fetch user balances for my-ads:', balErr);
    }

    // Clean filter out any deleted items and attach live available balance
    ads = ads
      .filter((a) => (a.status || '').toUpperCase() !== 'DELETED')
      .map((ad) => {
        const coin = (ad.coin || ad.crypto || ad.asset || ad.asset_symbol || 'USDT').toUpperCase();
        const liveBalance = balances[coin] !== undefined ? balances[coin] : 0;
        return {
          ...ad,
          available_crypto: liveBalance,
          available_amount: liveBalance,
          user_balances: balances,
        };
      });

    if (queryError && ads.length === 0) {
      return NextResponse.json({ error: queryError.message, ads: [] }, { status: 200 });
    }

    return NextResponse.json({ success: true, ads, balances });
  } catch (err: any) {
    console.error('Error fetching user ads:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error', ads: [] }, { status: 500 });
  }
}
