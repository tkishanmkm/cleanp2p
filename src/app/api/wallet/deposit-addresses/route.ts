import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase public authentication configuration is missing');
  }

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl) {
      throw new Error('Supabase URL is not configured');
    }

    let userId: string | null = null;

    // 1. Check Bearer Authorization Header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await getAuthClient().auth.getUser(token);
        if (!error && data?.user?.id) {
          userId = data.user.id;
        }
      } catch {
        // Fall back to cookie auth
      }
    }

    // 2. Check SSR Cookie Session
    if (!userId) {
      try {
        const cookieStore = await cookies();
        const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
          },
        });
        const {
          data: { user },
        } = await ssrClient.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch {
        // Fall back
      }
    }

    // 3. Only proceed with an identity verified by Supabase auth.
    // Never treat a caller-supplied query parameter as proof of identity.

    // Authenticated user logic
    if (userId) {
      const result = await getOrDeriveUserDepositAddresses(userId);

      return NextResponse.json({
        success: true,
        wallet_index: result.walletIndex,
        addresses: {
          evm: result.addresses.ETH,
          tron: result.addresses.USDT_TRC20,
          btc: result.addresses.BTC,
          ltc: result.addresses.LTC,
          // Cross-compatible keys for UI components
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
    }

    // Never return shared/default deposit addresses to unauthenticated callers.
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  } catch (err: unknown) {
    console.error(
      '[GET /api/wallet/deposit-addresses] Canonical provisioning failed:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { success: false, error: 'Deposit addresses are temporarily unavailable. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
