import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { deriveEvmAddress } from '@/lib/crypto/hd-engine';

export { deriveEvmAddress };
export const dynamic = 'force-dynamic';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const supabaseAuthClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function resolveAuthenticatedUserId(req: NextRequest): Promise<string | null> {
  // Never trust caller-supplied x-user-id or user_id query parameters.
  const authHeader = req.headers.get('authorization');
  if (authHeader?.match(/^Bearer\s+/i)) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (!error && data.user?.id) return data.user.id;
  }

  if (!supabaseUrl || !supabaseAnonKey) return null;

  try {
    const cookieStore = await cookies();
    const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          // This route only reads the session; it does not refresh or write cookies.
        },
      },
    });
    const { data, error } = await ssrSupabase.auth.getUser();
    if (!error && data.user?.id) return data.user.id;
  } catch {
    // Fail closed when session verification fails.
  }

  return null;
}

import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveAuthenticatedUserId(req);
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
        BTC: result.addresses.BTC,
        ETH: result.addresses.ETH,
        LTC: result.addresses.LTC,
        USDT_ERC20: result.addresses.USDT_ERC20,
        USDT_BEP20: result.addresses.USDT_BEP20,
        USDT_TRC20: result.addresses.USDT_TRC20,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to retrieve deposit address';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}
