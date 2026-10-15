import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Server-side Supabase configuration is incomplete.');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; 
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ success: false, error: 'Authentication is not configured.' }, { status: 503 });
    }

    const adminClient = getAdminClient();
    let userId: string | null = null;

    // 1. Check Bearer Authorization Header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await adminClient.auth.getUser(token);
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
        } = await ssrClient.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch {
        // Fall back
      }
    }

    // 4. Authenticated / identified user logic
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

    return NextResponse.json(
      { success: false, authenticated: false, error: 'Authentication required.' },
      { status: 401 }
    );
  } catch (err: unknown) {
    console.error('[GET /api/wallet/deposit-addresses] Address retrieval failed.');
    return NextResponse.json(
      { success: false, error: 'Unable to retrieve deposit addresses.' },
      { status: 500 }
    );
  }
}
