import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys, deriveEvmAddress } from '@/lib/crypto/hd-engine';

export { deriveEvmAddress };
export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function resolveUserId(req: NextRequest): Promise<string | null> {
  let userId = req.headers.get('x-user-id');
  if (userId) return userId;

  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data } = await supabaseAdmin.auth.getUser(token);
      if (data?.user?.id) return data.user.id;
    } catch {}
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (supabaseUrl && supabaseAnonKey) {
    try {
      const cookieStore = cookies();
      const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: { getAll: () => cookieStore.getAll() },
      });
      const { data: { user } } = await ssrSupabase.auth.getUser();
      if (user?.id) return user.id;
    } catch {}
  }

  const { searchParams } = new URL(req.url);
  return searchParams.get('user_id');
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
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to retrieve deposit address' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}
