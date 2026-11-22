import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getOrDeriveUserDepositAddresses } from '@/lib/hd-derivation-engine';

/**
 * Authenticate session via @supabase/ssr cookies or Authorization Bearer header
 */
async function getAuthenticatedUser(req: NextRequest) {
  // 1. Check Bearer token in Authorization header
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '').trim();
    try {
      const admin = getSupabaseAdminClient();
      const { data, error } = await admin.auth.getUser(token);
      if (!error && data?.user) {
        return data.user;
      }
    } catch {
      // continue to cookie checks
    }
  }

  // 2. Use @supabase/ssr with request cookies
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

    if (supabaseUrl && supabaseAnonKey) {
      const supabaseServer = createServerClient(supabaseUrl, supabaseAnonKey, {
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

      const { data: { user }, error } = await supabaseServer.auth.getUser();
      if (!error && user) {
        return user;
      }
    }
  } catch (err) {
    console.warn("Deposit address cookie session auth check:", err);
  }

  // 3. Fallback: Parse Supabase session tokens stored in cookies
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    for (const c of allCookies) {
      if (c.name.includes('auth-token') || c.name.startsWith('sb-')) {
        try {
          const parsed = JSON.parse(decodeURIComponent(c.value));
          const accessToken = parsed.access_token || parsed[0];
          if (accessToken && typeof accessToken === 'string') {
            const admin = getSupabaseAdminClient();
            const { data, error } = await admin.auth.getUser(accessToken);
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

async function handleDepositAddressRequest(req: NextRequest) {
  try {
    // 1. Authenticate user session
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse asset and network from query params or JSON body
    let assetParam = '';
    let networkParam = '';

    if (req.method === 'GET') {
      const url = new URL(req.url);
      assetParam = url.searchParams.get('asset') || url.searchParams.get('crypto') || url.searchParams.get('asset_code') || '';
      networkParam = url.searchParams.get('network') || url.searchParams.get('chain') || url.searchParams.get('network_code') || '';
    } else {
      const body = await req.json().catch(() => ({}));
      assetParam = body.asset || body.crypto || body.asset_code || '';
      networkParam = body.network || body.chain || body.network_code || '';
    }

    const asset = (assetParam || 'USDT').toUpperCase().trim();
    let network = (networkParam || (asset === 'ETH' ? 'ETH' : asset === 'BTC' ? 'BTC' : asset === 'LTC' ? 'LTC' : 'TRC20')).toUpperCase().trim();

    if (asset === 'ETH' && !network) network = 'ETH';
    if (asset === 'BTC') network = 'BTC';
    if (asset === 'LTC') network = 'LTC';
    if (asset === 'USDT' && (!network || network === 'USDT')) network = 'TRC20';

    const supabaseAdmin = getSupabaseAdminClient();

    // 3. Query public.deposit_addresses for existing active address
    const { data: existingRecords, error: queryError } = await supabaseAdmin
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (!queryError && existingRecords && existingRecords.length > 0) {
      // Find matching asset and network (handling both asset_code and asset field variations)
      const match = existingRecords.find((rec: any) => {
        const recAsset = (rec.asset_code || rec.asset || '').toUpperCase();
        const recNetwork = (rec.network_code || rec.network || '').toUpperCase();
        return (recAsset === asset || recAsset === '') && (recNetwork === network || recNetwork === '' || (!recNetwork && asset === network));
      });

      if (match?.address) {
        return NextResponse.json({
          address: match.address,
          network: match.network_code || match.network || network,
        }, { status: 200 });
      }
    }

    // 4. Trigger canonical provisioning via atomic RPC
    const provisionResult = await getOrDeriveUserDepositAddresses(user.id);
    let derivedAddress = provisionResult.addresses.ETH;
    if (asset === 'BTC') derivedAddress = provisionResult.addresses.BTC;
    if (asset === 'LTC') derivedAddress = provisionResult.addresses.LTC;
    if (network === 'TRC20' || asset === 'TRX') derivedAddress = provisionResult.addresses.USDT_TRC20;

    return NextResponse.json({
      address: derivedAddress,
      network: network,
    }, { status: 200 });
  } catch (err: any) {
    console.error("Deposit address error:", err);
    return NextResponse.json(
      { error: err?.message || 'An unexpected error occurred while generating deposit address.' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleDepositAddressRequest(req);
}

export async function POST(req: NextRequest) {
  return handleDepositAddressRequest(req);
}
