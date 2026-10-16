import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('[GET /api/wallet/deposit-addresses] Supabase auth configuration is missing');
      return NextResponse.json(
        { success: false, error: 'Wallet service is temporarily unavailable' },
        { status: 503 }
      );
    }

    let userId: string | null = null;

    // Resolve identity only from a token validated by Supabase.
    const authHeader = req.headers.get('authorization');
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const authClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await authClient.auth.getUser(token);
        if (!error && data.user?.id) {
          userId = data.user.id;
        }
      }
    }

    // Fall back to the verified Supabase SSR cookie session.
    if (!userId) {
      const cookieStore = cookies();
      const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      });
      const {
        data: { user },
        error,
      } = await ssrClient.auth.getUser();
      if (!error && user?.id) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const result = await getOrDeriveUserDepositAddresses(userId);

    return NextResponse.json({
      success: true,
      wallet_index: result.walletIndex,
      addresses: {
        evm: result.addresses.ETH,
        tron: result.addresses.USDT_TRC20,
        btc: result.addresses.BTC,
        ltc: result.addresses.LTC,
        BTC: result.addresses.BTC,
        ETH: result.addresses.ETH,
        LTC: result.addresses.LTC,
        USDT_ERC20: result.addresses.USDT_ERC20,
        USDT_BEP20: result.addresses.USDT_BEP20,
        USDT_TRC20: result.addresses.USDT_TRC20,
      },
      userId: result.userId,
      walletIndex: result.walletIndex,
      profile: result.profile || null,
      records: result.records,
      metadata: result.metadata,
    });
  } catch (err: unknown) {
    // Keep internal exception details in server logs; do not expose them to clients.
    console.error('[GET /api/wallet/deposit-addresses] Request failed:', err);
    return NextResponse.json(
      { success: false, error: 'Unable to retrieve deposit addresses' },
      { status: 500 }
    );
  }
}
