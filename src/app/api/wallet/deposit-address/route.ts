import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';

function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const authKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !authKey) return null;

  return createClient(supabaseUrl, authKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveUserId(req: NextRequest): Promise<string | null> {
  // Never trust a caller-supplied user ID header; identify users only from verified auth.
  const authClient = getAuthClient();
  const authHeader = req.headers.get('authorization');
  if (authClient && authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data } = await authClient.auth.getUser(token);
      if (data?.user?.id) return data.user.id;
    } catch {}
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const cookieStore = await cookies();
      const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: { getAll: () => cookieStore.getAll() },
      });
      const { data: { user } } = await ssrSupabase.auth.getUser();
      if (user?.id) return user.id;
    } catch {}
  }

  // Do not accept user_id query parameters as an authentication substitute.
  return null;
}

import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
        // Standard uppercase mappings for all frontend components
        BTC: result.addresses.BTC,
        ETH: result.addresses.ETH,
        LTC: result.addresses.LTC,
        USDT_ERC20: result.addresses.USDT_ERC20,
        USDT_BEP20: result.addresses.USDT_BEP20,
        USDT_TRC20: result.addresses.USDT_TRC20,
      },
    });
  } catch (err: unknown) {
    console.error(
      '[WALLET_DEPOSIT_ADDRESS] Canonical provisioning failed:',
      err instanceof Error ? err.name : 'UnknownError'
    );
    return NextResponse.json(
      { success: false, error: 'Deposit address is temporarily unavailable. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}
