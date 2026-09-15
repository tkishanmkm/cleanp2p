import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys, deriveEvmAddress } from '@/lib/crypto/hd-engine';

export { deriveEvmAddress };
export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const MASTER_MNEMONIC =
  process.env.DEPOSIT_HD_MNEMONIC ||
  process.env.HD_WALLET_MNEMONIC ||
  process.env.SEED ||
  SYSTEM_CONFIG?.mnemonic ||
  'sword purity trial drum middle either cool enhance hurt ridge clinic village';

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    if (!MASTER_MNEMONIC) {
      return NextResponse.json({ error: 'Server misconfiguration: HD_WALLET_MNEMONIC missing' }, { status: 500 });
    }

    const userId = await resolveUserId(req);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch user profile to get wallet_index
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, btc_deposit_address, tron_deposit_address, ltc_deposit_address')
      .eq('id', userId)
      .maybeSingle();

    let walletIndex: number | undefined = profile?.wallet_index;

    // 2. Fallback check on wallets table if wallet_index is missing
    if (walletIndex === undefined || walletIndex === null || walletIndex <= 0) {
      const { data: existingWallets } = await supabaseAdmin
        .from('wallets')
        .select('derivation_index')
        .eq('user_id', userId)
        .not('derivation_index', 'is', null)
        .order('derivation_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingWallets?.derivation_index) {
        walletIndex = existingWallets.derivation_index;
      }
    }

    // 3. If still no index, allocate next sequential index
    if (walletIndex === undefined || walletIndex === null || walletIndex <= 0) {
      const { data: maxProfile } = await supabaseAdmin
        .from('profiles')
        .select('wallet_index')
        .order('wallet_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: maxWallet } = await supabaseAdmin
        .from('wallets')
        .select('derivation_index')
        .order('derivation_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      const maxIdx = Math.max(maxProfile?.wallet_index ?? 0, maxWallet?.derivation_index ?? 0);
      walletIndex = maxIdx + 1;
    }

    // 4. Authoritative derivation from Master Mnemonic for this index
    const keys = await deriveUserKeys(MASTER_MNEMONIC, walletIndex);
    const evmAddress = keys.evm.address;
    const tronAddress = keys.tron.address;
    const btcAddress = keys.btc.address;
    const ltcAddress = keys.ltc.address;

    // 5. Always synchronize and heal stale/placeholder records in database
    const needsProfileUpdate =
      profile?.wallet_index !== walletIndex ||
      profile?.evm_deposit_address !== evmAddress ||
      profile?.tron_deposit_address !== tronAddress ||
      profile?.btc_deposit_address !== btcAddress ||
      profile?.ltc_deposit_address !== ltcAddress;

    if (needsProfileUpdate) {
      await supabaseAdmin.from('profiles').update({
        wallet_index: walletIndex,
        evm_deposit_address: evmAddress,
        tron_deposit_address: tronAddress,
        btc_deposit_address: btcAddress,
        ltc_deposit_address: ltcAddress,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    }

    // Synchronize public.wallets table
    await supabaseAdmin.from('wallets').upsert([
      { user_id: userId, chain: 'EVM', address: evmAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'TRON', address: tronAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'BTC', address: btcAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      { user_id: userId, chain: 'LTC', address: ltcAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
    ], { onConflict: 'user_id,chain' });

    // Synchronize public.deposit_addresses table
    try {
      await supabaseAdmin.from('deposit_addresses').upsert([
        { user_id: userId, asset_code: 'ETH', network_code: 'ERC20', address: evmAddress, status: 'active', derivation_index: walletIndex },
        { user_id: userId, asset_code: 'USDT', network_code: 'BEP20', address: evmAddress, status: 'active', derivation_index: walletIndex },
        { user_id: userId, asset_code: 'USDT', network_code: 'TRC20', address: tronAddress, status: 'active', derivation_index: walletIndex },
        { user_id: userId, asset_code: 'BTC', network_code: 'BTC', address: btcAddress, status: 'active', derivation_index: walletIndex },
        { user_id: userId, asset_code: 'LTC', network_code: 'LTC', address: ltcAddress, status: 'active', derivation_index: walletIndex },
      ], { onConflict: 'user_id,network_code,asset_code' });
    } catch (_) {}

    return NextResponse.json({
      success: true,
      wallet_index: walletIndex,
      addresses: {
        evm: evmAddress,
        tron: tronAddress,
        btc: btcAddress,
        ltc: ltcAddress,
        // Standard uppercase mappings for all frontend components
        BTC: btcAddress,
        ETH: evmAddress,
        LTC: ltcAddress,
        USDT_ERC20: evmAddress,
        USDT_BEP20: evmAddress,
        USDT_TRC20: tronAddress,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to retrieve deposit address' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}
