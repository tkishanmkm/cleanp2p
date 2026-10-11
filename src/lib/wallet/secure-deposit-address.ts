import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  getOrDeriveUserDepositAddresses,
  normalizeDepositNetwork,
  type CryptoDepositAddresses,
} from '@/lib/hd-derivation-engine';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const authClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function resolveWalletRouteUserId(req: NextRequest): Promise<string | null> {
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const { data, error } = await authClient.auth.getUser(bearer);
    if (!error && data.user?.id) return data.user.id;
  }

  try {
    const cookieStore = await cookies();
    const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {
          // These address endpoints only verify the current session.
        },
      },
    });
    const { data, error } = await ssrClient.auth.getUser();
    if (!error && data.user?.id) return data.user.id;
  } catch {
    // Fail closed on session errors.
  }

  return null;
}

function resolveRequestedAddress(
  addresses: CryptoDepositAddresses,
  requestedAsset: string,
  requestedNetwork: string
): { asset: string; network: string; address: string } | null {
  const asset = requestedAsset.toUpperCase().trim();
  let network = normalizeDepositNetwork(requestedNetwork || '');

  if (asset === 'BTC') return { asset, network: 'BTC', address: addresses.BTC };
  if (asset === 'LTC') return { asset, network: 'LTC', address: addresses.LTC };
  if (asset === 'ETH') return { asset, network: 'ETH', address: addresses.ETH };
  if (asset === 'BNB') return { asset, network: 'BEP20', address: addresses.USDT_BEP20 };
  if (asset === 'TRX') return { asset, network: 'TRC20', address: addresses.USDT_TRC20 };

  const tokenAssetMap: Record<string, keyof CryptoDepositAddresses> = {
    USDT_ERC20: 'USDT_ERC20',
    USDT_BEP20: 'USDT_BEP20',
    USDT_TRC20: 'USDT_TRC20',
  };

  if (tokenAssetMap[asset]) {
    const key = tokenAssetMap[asset];
    const net = key === 'USDT_ERC20' ? 'ERC20' : key === 'USDT_BEP20' ? 'BEP20' : 'TRC20';
    return { asset: 'USDT', network: net, address: addresses[key] };
  }

  if (asset !== 'USDT') return null;

  // Common aliases for the USDT network selector.
  if (network === 'ETH' || network === 'ETHEREUM') network = 'ERC20';
  if (network === 'BNB' || network === 'BSC' || network === 'BINANCE') network = 'BEP20';
  if (network === 'TRX' || network === 'TRON') network = 'TRC20';
  if (!network || network === 'USDT') network = 'TRC20';

  if (network === 'ERC20') return { asset, network, address: addresses.USDT_ERC20 };
  if (network === 'BEP20') return { asset, network, address: addresses.USDT_BEP20 };
  if (network === 'TRC20') return { asset, network, address: addresses.USDT_TRC20 };
  return null;
}

export async function handleSecureDepositAddressRequest(
  req: NextRequest,
  responseMode: 'deposit' | 'provision'
): Promise<NextResponse> {
  try {
    const userId = await resolveWalletRouteUserId(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let input: Record<string, unknown> = {};
    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams;
      input = {
        userId: params.get('userId') || params.get('user_id'),
        asset: params.get('asset') || params.get('crypto') || params.get('asset_code'),
        network: params.get('network') || params.get('chain') || params.get('network_code'),
      };
    } else {
      input = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
    }

    const requestedUserId = typeof input.userId === 'string'
      ? input.userId
      : typeof input.user_id === 'string'
        ? input.user_id
        : null;
    if (requestedUserId && requestedUserId !== userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const requestedAsset = String(input.asset || input.crypto || input.asset_code || 'USDT').trim().toUpperCase();
    const requestedNetwork = String(input.network || input.chain || input.network_code || '').trim().toUpperCase();

    const provisionResult = await getOrDeriveUserDepositAddresses(userId);
    const resolved = resolveRequestedAddress(provisionResult.addresses, requestedAsset, requestedNetwork);
    if (!resolved || !resolved.address) {
      return NextResponse.json(
        { success: false, error: 'Unsupported asset or network for deposit address.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (responseMode === 'provision') {
      const chain = resolved.network === 'BTC' || resolved.network === 'LTC'
        ? resolved.network
        : resolved.network === 'TRC20'
          ? 'TRON'
          : 'EVM';
      return NextResponse.json({
        success: true,
        userId,
        walletIndex: provisionResult.walletIndex,
        address: resolved.address,
        asset: resolved.asset,
        network: resolved.network,
        chain,
      }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({
      success: true,
      userId,
      walletIndex: provisionResult.walletIndex,
      address: resolved.address,
      network: resolved.network,
      asset: resolved.asset,
    }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to resolve deposit address.';
    console.error('[WalletDepositAddress] Failed to resolve canonical address:', message);
    return NextResponse.json(
      { success: false, error: 'Deposit address is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
