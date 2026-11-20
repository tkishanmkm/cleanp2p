import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey || /placeholder|your[_-]?project|your[_-]?anon[_-]?key/i.test(`${supabaseUrl} ${supabaseAnonKey}`)) {
      return NextResponse.json({ error: 'Authentication service is not configured.' }, { status: 503 });
    }

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    // Select exactly one credential source. An explicitly supplied Bearer
    // header must never fall back to a different browser-cookie identity.
    const authHeader = request.headers.get('authorization');
    let user = null;
    let authError: any = null;

    if (authHeader !== null) {
      const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
      const bearerToken = bearerMatch?.[1]?.trim() || null;
      if (!bearerToken) {
        return NextResponse.json({ error: 'Invalid authorization header.' }, { status: 401 });
      }

      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user || null;
      authError = tokenAuth.error;
    } else {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user || null;
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
      .order('created_at', { ascending: false })
      .limit(20);

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
        .order('created_at', { ascending: false })
        .limit(20);

      if (!tableError && Array.isArray(tableAds)) {
        ads = tableAds;
        queryError = null;
      } else {
        queryError = tableError;
      }
    }

    // 3. Fallback to admin client if RLS is preventing read
    if (ads.length === 0 && queryError) {
      try {
        const { data: adminAds, error: adminErr } = await admin
          .from('ads')
          .select('*')
          .eq('user_id', user.id)
          .neq('status', 'DELETED')
          .order('created_at', { ascending: false })
          .limit(20);

        if (!adminErr && Array.isArray(adminAds) && adminAds.length > 0) {
          ads = adminAds;
          queryError = null;
        }
      } catch (adminEx) {
        console.warn('Admin fallback in my-ads failed:', adminEx);
      }
    }

    if (queryError) {
      console.error('Unable to load owned ads from the canonical ad sources:', queryError.code || 'UNKNOWN');
      return NextResponse.json(
        { success: false, code: 'OWNED_ADS_UNAVAILABLE', error: 'Your advertisements could not be loaded safely.' },
        { status: 503 }
      );
    }

    // Fetch user balances to compute live available crypto for each ad.
    const balances: Record<string, number> = {
      BTC: 0,
      ETH: 0,
      USDT: 0,
      LTC: 0,
    };

    try {
      // wallet_assets is the canonical wallet used by both withdrawal
      // reservation and initiate_trade_with_escrow. The latter deducts escrow
      // from balance and increments in_escrow in the same transaction, so
      // balance is already the spendable amount. Legacy wallet mirrors must
      // never be max-merged into this value because they can be stale.
      const { data: walletAssets, error: walletAssetsError } = await admin
        .from('wallet_assets')
        .select('asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal')
        .eq('user_id', user.id);

      if (walletAssetsError) {
        console.error('Canonical wallet lookup failed for owned ads:', walletAssetsError.code || 'UNKNOWN');
        return NextResponse.json(
          { success: false, code: 'CANONICAL_WALLET_UNAVAILABLE', error: 'Your current available wallet balances could not be loaded.' },
          { status: 503 }
        );
      }

      const seenAssets = new Set<string>();
      for (const wallet of walletAssets || []) {
        const symbol = String(wallet.asset_symbol || '').trim().toUpperCase();
        const normalized = normalizePrimaryWalletAssetBalance(wallet);
        if (
          !symbol ||
          seenAssets.has(symbol) ||
          !normalized.accountingValid
        ) {
          console.error('Canonical wallet buckets require reconciliation before ad balances can be displayed.');
          return NextResponse.json(
            { success: false, code: 'WALLET_BALANCE_RECONCILIATION_REQUIRED', error: 'A wallet balance could not be verified. Ads were not assigned an available balance.' },
            { status: 503 }
          );
        }

        seenAssets.add(symbol);
        balances[symbol] = normalized.available;
      }
    } catch (balErr) {
      console.error('Canonical wallet balance lookup failed for my-ads:', balErr);
      return NextResponse.json(
        { success: false, code: 'CANONICAL_WALLET_UNAVAILABLE', error: 'Your current available wallet balances could not be loaded.' },
        { status: 503 }
      );
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


    return NextResponse.json({ success: true, ads, balances });
  } catch (err: any) {
    console.error('Error fetching user ads:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error', ads: [] }, { status: 500 });
  }
}
