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

const MASTER_MNEMONIC = process.env.HD_WALLET_MNEMONIC || SYSTEM_CONFIG?.mnemonic;

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

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, btc_deposit_address, tron_deposit_address, ltc_deposit_address')
      .eq('id', userId)
      .maybeSingle();

    let walletIndex = profile?.wallet_index;
    let evmAddress = profile?.evm_deposit_address;
    let tronAddress = profile?.tron_deposit_address;
    let btcAddress = profile?.btc_deposit_address;
    let ltcAddress = profile?.ltc_deposit_address;

    const { data: existingWallets } = await supabaseAdmin
      .from('wallets')
      .select('chain, address, derivation_index')
      .eq('user_id', userId);

    existingWallets?.forEach((w) => {
      const chain = (w.chain || '').toLowerCase();
      if (w.derivation_index !== undefined && w.derivation_index !== null && walletIndex === undefined) {
        walletIndex = w.derivation_index;
      }
      if (w.address) {
        if (['evm', 'erc20', 'eth', 'bep20'].includes(chain)) evmAddress = evmAddress || w.address;
        if (['tron', 'trc20', 'trx'].includes(chain)) tronAddress = tronAddress || w.address;
        if (['btc', 'bitcoin'].includes(chain)) btcAddress = btcAddress || w.address;
        if (['ltc', 'litecoin'].includes(chain)) ltcAddress = ltcAddress || w.address;
      }
    });

    if (!evmAddress || !tronAddress || !btcAddress || !ltcAddress || walletIndex === undefined || walletIndex === null) {
      if (walletIndex === undefined || walletIndex === null) {
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

      const keys = await deriveUserKeys(MASTER_MNEMONIC, walletIndex);
      evmAddress = evmAddress || keys.evm.address;
      tronAddress = tronAddress || keys.tron.address;
      btcAddress = btcAddress || keys.btc.address;
      ltcAddress = ltcAddress || keys.ltc.address;

      await supabaseAdmin.from('profiles').update({
        wallet_index: walletIndex,
        evm_deposit_address: evmAddress,
        tron_deposit_address: tronAddress,
        btc_deposit_address: btcAddress,
        ltc_deposit_address: ltcAddress,
      }).eq('id', userId);

      await supabaseAdmin.from('wallets').upsert([
        { user_id: userId, chain: 'EVM', address: evmAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'TRON', address: tronAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'BTC', address: btcAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'LTC', address: ltcAddress, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      ], { onConflict: 'user_id,chain' });
    }

    return NextResponse.json({
      success: true,
      wallet_index: walletIndex,
      addresses: { evm: evmAddress, tron: tronAddress, btc: btcAddress, ltc: ltcAddress },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to retrieve deposit address' }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return GET(req);
}
