import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const authClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function resolveAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization');
  if (authHeader?.match(/^Bearer\s+/i)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data, error } = await authClient.auth.getUser(token);
    if (!error && data.user?.id) return data.user.id;
  }

  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const cookieStore = await cookies();
    const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          // Read-only session verification for this endpoint.
        },
      },
    });
    const { data, error } = await ssrClient.auth.getUser();
    if (!error && data.user?.id) return data.user.id;
  } catch {
    // Fail closed if session verification fails.
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const result = await getOrDeriveUserDepositAddresses(userId);
    return NextResponse.json({
      success: true,
      authenticated: true,
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
    const message = err instanceof Error ? err.message : 'Failed to retrieve deposit addresses';
    console.error('[GET /api/wallet/deposit-addresses] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
