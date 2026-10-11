import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
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

function resolveCanonicalAddress(addresses: Record<string, string>, symbol: string): string | null {
  const map: Record<string, string> = {
    ETH: 'ETH',
    BTC: 'BTC',
    LTC: 'LTC',
    USDT_ERC20: 'USDT_ERC20',
    USDT_BEP20: 'USDT_BEP20',
    USDT_TRC20: 'USDT_TRC20',
  };
  const key = map[symbol];
  return key ? addresses[key] || null : null;
}

function addressesMatch(symbol: string, existingAddress: string, canonicalAddress: string): boolean {
  // EVM and Bech32 addresses are case-insensitive; TRON Base58 addresses are case-sensitive.
  if (symbol === 'USDT_TRC20') return existingAddress === canonicalAddress;
  return existingAddress.toLowerCase() === canonicalAddress.toLowerCase();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const userId = await resolveAuthenticatedUserId(req);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const symbol = String(body.assetSymbol || '').trim().toUpperCase();
    const allowed = new Set(['ETH', 'BTC', 'LTC', 'USDT_ERC20', 'USDT_BEP20', 'USDT_TRC20']);
    if (!allowed.has(symbol)) {
      return NextResponse.json({ success: false, error: 'Unsupported assetSymbol' }, { status: 400 });
    }

    const derived = await getOrDeriveUserDepositAddresses(userId);
    const depositAddress = resolveCanonicalAddress(derived.addresses as Record<string, string>, symbol);
    if (!depositAddress) {
      return NextResponse.json({ success: false, error: 'No canonical deposit address is configured for this asset' }, { status: 503 });
    }

    const admin = getSupabaseAdminClient();
    const { data: existingWallet, error: readError } = await admin
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('asset_symbol', symbol)
      .maybeSingle();

    if (readError) throw readError;

    if (existingWallet) {
      if (existingWallet.deposit_address && !addressesMatch(symbol, String(existingWallet.deposit_address), depositAddress)) {
        return NextResponse.json({
          success: false,
          error: 'A legacy deposit address differs from the canonical derived address. The record was not overwritten; manual reconciliation is required before changing it.',
        }, { status: 409 });
      }
      if (existingWallet.deposit_address) {
        return NextResponse.json({ success: true, wallet: existingWallet });
      }
      const { data: updatedWallet, error: updateError } = await admin
        .from('user_wallets')
        .update({ deposit_address: depositAddress, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('asset_symbol', symbol)
        .select()
        .single();
      if (updateError) throw updateError;
      return NextResponse.json({ success: true, wallet: updatedWallet });
    }

    const { data: newWallet, error: insertError } = await admin
      .from('user_wallets')
      .insert({
        user_id: userId,
        asset_symbol: symbol,
        deposit_address: depositAddress,
        balance: 0,
        locked_balance: 0,
      })
      .select()
      .single();

    if (insertError) throw insertError;
    return NextResponse.json({ success: true, wallet: newWallet });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[POST /api/wallet/create-address] Error:', message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
