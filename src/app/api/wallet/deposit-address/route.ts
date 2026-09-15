import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { SYSTEM_CONFIG } from '@/lib/config/env';
import { deriveUserKeys } from '@/lib/crypto/hd-engine';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const MASTER_MNEMONIC = process.env.HD_WALLET_MNEMONIC || SYSTEM_CONFIG.mnemonic || 'test test test test test test test test test test test junk';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    let userId = req.headers.get('x-user-id');

    // 1. Check Bearer Authorization header if x-user-id not present
    if (!userId) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        try {
          const { data } = await supabaseAdmin.auth.getUser(token);
          if (data?.user?.id) {
            userId = data.user.id;
          }
        } catch {
          // Fallback
        }
      }
    }

    // 2. Check Cookie Authentication if still not found
    if (!userId && supabaseUrl && supabaseAnonKey) {
      try {
        const cookieStore = cookies();
        const ssrSupabase = createServerClient(supabaseUrl, supabaseAnonKey, {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
          },
        });
        const { data: { user } } = await ssrSupabase.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch {
        // Fallback
      }
    }

    // 3. Check query parameter fallback
    if (!userId) {
      const { searchParams } = new URL(req.url);
      const queryUserId = searchParams.get('user_id');
      if (queryUserId) {
        userId = queryUserId;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 4. Fetch profile to check existing addresses and wallet_index
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

    // 5. Check wallets table for existing entries
    const { data: existingWallets } = await supabaseAdmin
      .from('wallets')
      .select('chain, address, derivation_index')
      .eq('user_id', userId);

    existingWallets?.forEach((w: { chain?: string; address?: string; derivation_index?: number }) => {
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

    // 6. If any core address is missing, derive dynamically using next unique index
    if (!evmAddress || !tronAddress || !btcAddress || !ltcAddress || walletIndex === undefined || walletIndex === null) {
      if (walletIndex === undefined || walletIndex === null) {
        // Query max derivation index across profiles and wallets
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

        const maxIdx = Math.max(
          maxProfile?.wallet_index ?? 0,
          maxWallet?.derivation_index ?? 0
        );

        walletIndex = maxIdx + 1;
      }

      // Derive HD keys deterministically for EVM, TRON, BTC, LTC
      const keys = await deriveUserKeys(MASTER_MNEMONIC, walletIndex);
      evmAddress = evmAddress || keys.evm.address;
      tronAddress = tronAddress || keys.tron.address;
      btcAddress = btcAddress || keys.btc.address;
      ltcAddress = ltcAddress || keys.ltc.address;

      // Update profiles record
      await supabaseAdmin
        .from('profiles')
        .update({
          wallet_index: walletIndex,
          evm_deposit_address: evmAddress,
          tron_deposit_address: tronAddress,
          btc_deposit_address: btcAddress,
          ltc_deposit_address: ltcAddress,
        })
        .eq('id', userId);

      // Insert/upsert into wallets records if table exists
      try {
        await supabaseAdmin.from('wallets').upsert([
          {
            user_id: userId,
            chain: 'EVM',
            address: evmAddress,
            derivation_index: walletIndex,
            funding_status: 'UNFUNDED',
          },
          {
            user_id: userId,
            chain: 'TRON',
            address: tronAddress,
            derivation_index: walletIndex,
            funding_status: 'UNFUNDED',
          },
          {
            user_id: userId,
            chain: 'BTC',
            address: btcAddress,
            derivation_index: walletIndex,
            funding_status: 'UNFUNDED',
          },
          {
            user_id: userId,
            chain: 'LTC',
            address: ltcAddress,
            derivation_index: walletIndex,
            funding_status: 'UNFUNDED',
          },
        ]);
      } catch {
        // Continue safely if wallets columns differ
      }
    }

    return NextResponse.json({
      success: true,
      wallet_index: walletIndex,
      addresses: {
        evm: evmAddress,
        tron: tronAddress,
        btc: btcAddress,
        ltc: ltcAddress,
      },
    });
  } catch (err: any) {
    console.error('Deposit address generation error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to retrieve deposit address' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId || req.headers.get('x-user-id');
    const requestedChain = (body?.chain || 'EVM').toUpperCase();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized: missing userId' }, { status: 401 });
    }

    // 1. Check existing address in wallets
    const { data: existingWallet } = await supabaseAdmin
      .from('wallets')
      .select('address')
      .eq('user_id', userId)
      .ilike('chain', requestedChain)
      .maybeSingle();

    if (existingWallet?.address) {
      return NextResponse.json({
        success: true,
        chain: requestedChain,
        address: existingWallet.address,
      });
    }

    // 2. Fetch profile to check wallet_index or deposit address
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, btc_deposit_address, tron_deposit_address, ltc_deposit_address')
      .eq('id', userId)
      .maybeSingle();

    let walletIndex = profile?.wallet_index;

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

      const maxIdx = Math.max(
        maxProfile?.wallet_index ?? 0,
        maxWallet?.derivation_index ?? 0
      );

      walletIndex = maxIdx + 1;
    }

    // Derive all addresses for this index
    const keys = await deriveUserKeys(MASTER_MNEMONIC, walletIndex);

    // Update profiles
    await supabaseAdmin
      .from('profiles')
      .update({
        wallet_index: walletIndex,
        evm_deposit_address: keys.evm.address,
        tron_deposit_address: keys.tron.address,
        btc_deposit_address: keys.btc.address,
        ltc_deposit_address: keys.ltc.address,
      })
      .eq('id', userId);

    // Upsert to wallets
    try {
      await supabaseAdmin.from('wallets').upsert([
        { user_id: userId, chain: 'EVM', address: keys.evm.address, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'TRON', address: keys.tron.address, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'BTC', address: keys.btc.address, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
        { user_id: userId, chain: 'LTC', address: keys.ltc.address, derivation_index: walletIndex, funding_status: 'UNFUNDED' },
      ]);
    } catch {
      // Ignore if table differences exist
    }

    let resolvedAddress = keys.evm.address;
    if (requestedChain === 'BTC') resolvedAddress = keys.btc.address;
    if (requestedChain === 'TRON') resolvedAddress = keys.tron.address;
    if (requestedChain === 'LTC') resolvedAddress = keys.ltc.address;

    return NextResponse.json({
      success: true,
      chain: requestedChain,
      address: resolvedAddress,
      addresses: {
        evm: keys.evm.address,
        tron: keys.tron.address,
        btc: keys.btc.address,
        ltc: keys.ltc.address,
      },
    });
  } catch (err: any) {
    console.error('POST deposit address generation error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to generate deposit address' },
      { status: 500 }
    );
  }
}

