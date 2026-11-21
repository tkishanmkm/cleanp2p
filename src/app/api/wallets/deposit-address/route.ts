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
    const user = await getAuthenticatedUser(req);
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    let body: Record<string, unknown> = {};
    let assetInput = '';
    let networkInput = '';

    if (req.method === 'GET') {
      const url = new URL(req.url);
      assetInput =
        url.searchParams.get('asset') ||
        url.searchParams.get('crypto') ||
        url.searchParams.get('asset_code') ||
        '';
      networkInput =
        url.searchParams.get('network') ||
        url.searchParams.get('chain') ||
        url.searchParams.get('network_code') ||
        '';
    } else {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).byteLength > 2048) {
        return NextResponse.json(
          { success: false, error: 'Deposit-address request is too large.' },
          { status: 413, headers: { 'Cache-Control': 'no-store' } }
        );
      }

      if (raw.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return NextResponse.json(
            { success: false, error: 'A valid JSON object is required.' },
            { status: 400, headers: { 'Cache-Control': 'no-store' } }
          );
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json(
            { success: false, error: 'A valid JSON object is required.' },
            { status: 400, headers: { 'Cache-Control': 'no-store' } }
          );
        }
        body = parsed as Record<string, unknown>;
      }

      assetInput = String(body.asset || body.crypto || body.asset_code || '');
      networkInput = String(body.network || body.chain || body.network_code || '');
    }

    const asset = (assetInput || 'USDT').trim().toUpperCase();
    const rawNetwork = (networkInput || (asset === 'BTC' ? 'BTC' : asset === 'LTC' ? 'LTC' : asset === 'ETH' ? 'ETH' : 'TRC20'))
      .trim()
      .toUpperCase();

    let normalizedNetwork: 'BTC' | 'LTC' | 'ETH' | 'ERC20' | 'BEP20' | 'TRC20';
    if (asset === 'BTC' && ['BTC', 'BITCOIN'].includes(rawNetwork)) {
      normalizedNetwork = 'BTC';
    } else if (asset === 'LTC' && ['LTC', 'LITECOIN'].includes(rawNetwork)) {
      normalizedNetwork = 'LTC';
    } else if (asset === 'ETH' && ['ETH', 'ETHEREUM', 'MAINNET'].includes(rawNetwork)) {
      normalizedNetwork = 'ETH';
    } else if (asset === 'USDT' && ['ERC20', 'USDT_ERC20', 'ETHEREUM'].includes(rawNetwork)) {
      normalizedNetwork = 'ERC20';
    } else if (asset === 'USDT' && ['BEP20', 'USDT_BEP20', 'BSC'].includes(rawNetwork)) {
      normalizedNetwork = 'BEP20';
    } else if (asset === 'USDT' && ['TRC20', 'USDT_TRC20', 'TRON'].includes(rawNetwork)) {
      normalizedNetwork = 'TRC20';
    } else {
      return NextResponse.json(
        { success: false, error: 'Unsupported asset/network combination.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Always resolve through the assigned profile index and the atomic
    // provisioning RPC. Do not serve legacy deposit_addresses rows first:
    // historical rows may not belong to any current auth user/profile.
    const provisionResult = await getOrDeriveUserDepositAddresses(user.id);
    let address: string;

    switch (normalizedNetwork) {
      case 'BTC':
        address = provisionResult.addresses.BTC;
        break;
      case 'LTC':
        address = provisionResult.addresses.LTC;
        break;
      case 'ETH':
        address = provisionResult.addresses.ETH;
        break;
      case 'ERC20':
        address = provisionResult.addresses.USDT_ERC20;
        break;
      case 'BEP20':
        address = provisionResult.addresses.USDT_BEP20;
        break;
      case 'TRC20':
        address = provisionResult.addresses.USDT_TRC20;
        break;
    }

    return NextResponse.json(
      {
        success: true,
        address,
        asset,
        network: normalizedNetwork,
        derivationIndex: provisionResult.walletIndex,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error: unknown) {
    console.error(
      '[DEPOSIT_ADDRESS] Canonical address lookup failed:',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return NextResponse.json(
      { success: false, error: 'Deposit address is temporarily unavailable. Please retry.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET(req: NextRequest) {
  return handleDepositAddressRequest(req);
}

export async function POST(req: NextRequest) {
  return handleDepositAddressRequest(req);
}
