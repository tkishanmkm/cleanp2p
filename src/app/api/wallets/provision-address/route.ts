import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

/**
 * Initializes Supabase Admin Client bypassing RLS policies
 */
function getAdminSupabaseClient(): SupabaseClient {
  return getSupabaseAdminClient();
}

/**
 * Authenticates user from request session cookies or Authorization Bearer header
 */
async function authenticateRequest(req: NextRequest, adminClient: SupabaseClient) {
  // 1. Check Bearer Authorization Header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
      const { data, error } = await adminClient.auth.getUser(token);
      if (!error && data?.user) {
        return data.user;
      }
    } catch {
      // fallback to cookies
    }
  }

  // 2. Authenticate via @supabase/ssr request cookies
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    if (supabaseUrl && anonKey) {
      const supabaseUserClient = createServerClient(supabaseUrl, anonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore in route handler context
            }
          },
        },
      });

      const { data: { user }, error } = await supabaseUserClient.auth.getUser();
      if (!error && user) {
        return user;
      }
    }
  } catch (cookieErr) {
    console.warn("Cookie session resolution warning:", cookieErr);
  }

  // 3. Fallback: Parse Supabase session access tokens from cookies
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    for (const c of allCookies) {
      if (c.name.includes('auth-token') || c.name.startsWith('sb-')) {
        try {
          const parsed = JSON.parse(decodeURIComponent(c.value));
          const accessToken = parsed.access_token || parsed[0];
          if (accessToken && typeof accessToken === 'string') {
            const { data, error } = await adminClient.auth.getUser(accessToken);
            if (!error && data?.user) {
              return data.user;
            }
          }
        } catch {
          // ignore parsing error
        }
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Normalizes input chain/asset into canonical chain category:
 * - BNB / ETH / ERC20 / BEP20 / EVM -> "EVM"
 * - BTC -> "BTC"
 * - LTC -> "LTC"
 * - TRX / USDT-TRC20 / TRON -> "TRON"
 */
function normalizeChain(input: string): 'EVM' | 'BTC' | 'LTC' | 'TRON' {
  const norm = (input || '').toUpperCase().trim();
  if (['BTC', 'BITCOIN'].includes(norm)) return 'BTC';
  if (['LTC', 'LITECOIN'].includes(norm)) return 'LTC';
  if (['TRON', 'TRX', 'TRC20', 'USDT-TRC20', 'USDT_TRC20'].includes(norm)) return 'TRON';
  return 'EVM';
}

/**
 * Main Provisioning Handler
 */
async function handleProvisioning(req: NextRequest) {
  try {
    // 1. Initialize Supabase Admin Client
    const adminClient = getAdminSupabaseClient();

    // 2. Authenticate Request
    const user = await authenticateRequest(req, adminClient);
    if (!user || !user.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized. Please sign in to view and provision deposit addresses.' },
        { status: 401 }
      );
    }

    // 3. Parse input body / params
    let rawChain = '';
    let rawAsset = '';
    let rawNetwork = '';

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      rawChain = body.chain || '';
      rawAsset = body.asset || '';
      rawNetwork = body.network || '';
    } else {
      const url = new URL(req.url);
      rawChain = url.searchParams.get('chain') || '';
      rawAsset = url.searchParams.get('asset') || '';
      rawNetwork = url.searchParams.get('network') || '';
    }

    const chainCategory = normalizeChain(rawChain || rawNetwork || rawAsset);

    // 4. Idempotent Lookup in deposit_addresses via Admin Client
    const { data: existingRecords, error: lookupError } = await adminClient
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (lookupError) {
      console.warn("deposit_addresses lookup warning:", lookupError);
    }

    if (existingRecords && existingRecords.length > 0) {
      const existingMatch = existingRecords.find((rec: any) => {
        const net = (rec.network_code || rec.network || '').toUpperCase();
        const ast = (rec.asset_code || rec.asset || '').toUpperCase();
        const chn = (rec.chain || '').toUpperCase();

        if (chainCategory === 'EVM') {
          return (
            chn === 'EVM' ||
            net === 'BEP20' ||
            net === 'ERC20' ||
            net === 'ETH' ||
            net === 'BSC' ||
            rec.address?.startsWith('0x')
          );
        } else if (chainCategory === 'BTC') {
          return chn === 'BTC' || net === 'BTC' || ast === 'BTC' || rec.address?.startsWith('bc1');
        } else if (chainCategory === 'LTC') {
          return chn === 'LTC' || net === 'LTC' || ast === 'LTC' || rec.address?.startsWith('ltc1');
        } else if (chainCategory === 'TRON') {
          return chn === 'TRON' || net === 'TRC20' || net === 'TRX' || ast === 'TRX' || rec.address?.startsWith('T');
        }
        return false;
      });

      if (existingMatch?.address) {
        return NextResponse.json({
          success: true,
          address: existingMatch.address,
          chain: chainCategory,
          network: existingMatch.network_code || chainCategory,
          asset: existingMatch.asset_code || rawAsset || chainCategory,
        }, { status: 200 });
      }
    }

    // 5. Trigger canonical provisioning via atomic RPC
    const provisionResult = await getOrDeriveUserDepositAddresses(user.id);
    let targetAddress = provisionResult.addresses.ETH;
    if (chainCategory === 'BTC') targetAddress = provisionResult.addresses.BTC;
    if (chainCategory === 'LTC') targetAddress = provisionResult.addresses.LTC;
    if (chainCategory === 'TRON') targetAddress = provisionResult.addresses.USDT_TRC20;

    return NextResponse.json({
      success: true,
      address: targetAddress,
      chain: chainCategory,
      network: chainCategory,
      asset: rawAsset || chainCategory,
    }, { status: 200 });

  } catch (err: any) {
    console.error("Error in /api/wallets/provision-address route:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Failed to provision deposit address. Please try again.',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return handleProvisioning(req);
}

export async function GET(req: NextRequest) {
  return handleProvisioning(req);
}
