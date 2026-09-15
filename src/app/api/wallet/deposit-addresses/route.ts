import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { getOrDeriveUserDepositAddresses, deriveAllAddresses } from '@/lib/hd-derivation-engine';

export const dynamic = 'force-dynamic';

function getAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://eaiwgfxoiwxepinvcykg.supabase.co';

  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL ||
      'https://eaiwgfxoiwxepinvcykg.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    const adminClient = getAdminClient();
    let userId: string | null = null;

    // 1. Check Bearer Authorization Header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await adminClient.auth.getUser(token);
        if (!error && data?.user?.id) {
          userId = data.user.id;
        }
      } catch {
        // Fall back to cookie auth
      }
    }

    // 2. Check SSR Cookie Session
    if (!userId) {
      try {
        const cookieStore = cookies();
        const ssrClient = createServerClient(supabaseUrl, supabaseAnonKey, {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
          },
        });
        const {
          data: { user },
        } = await ssrClient.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch {
        // Fall back
      }
    }

    // 3. Allow query parameter user_id override if present
    const { searchParams } = new URL(req.url);
    const queryUserId = searchParams.get('user_id');
    if (queryUserId && !userId) {
      userId = queryUserId;
    }

    // 4. Authenticated / identified user logic
    if (userId) {
      // Step A: Query public.profiles for the 4 deposit addresses and wallet_index
      const { data: profile, error: profileError } = await adminClient
        .from('profiles')
        .select('id, wallet_index, evm_deposit_address, tron_deposit_address, btc_deposit_address, ltc_deposit_address')
        .eq('id', userId)
        .maybeSingle();

      const hasAllFour =
        !profileError &&
        profile &&
        profile.evm_deposit_address &&
        profile.tron_deposit_address &&
        profile.btc_deposit_address &&
        profile.ltc_deposit_address;

      if (hasAllFour) {
        const walletIndex = typeof profile.wallet_index === 'number' && profile.wallet_index > 0
          ? profile.wallet_index
          : 1;

        return NextResponse.json({
          success: true,
          wallet_index: walletIndex,
          addresses: {
            evm: profile.evm_deposit_address,
            tron: profile.tron_deposit_address,
            btc: profile.btc_deposit_address,
            ltc: profile.ltc_deposit_address,
            // Cross-compatible keys for UI components
            BTC: profile.btc_deposit_address,
            ETH: profile.evm_deposit_address,
            LTC: profile.ltc_deposit_address,
            USDT_ERC20: profile.evm_deposit_address,
            USDT_BEP20: profile.evm_deposit_address,
            USDT_TRC20: profile.tron_deposit_address,
          },
          userId,
          walletIndex,
          profile,
        });
      }

      // Step B: Missing deposit addresses — trigger non-blocking key derivation and DB sync
      const result = await getOrDeriveUserDepositAddresses(userId);

      return NextResponse.json({
        success: true,
        wallet_index: result.walletIndex,
        addresses: {
          evm: result.addresses.ETH,
          tron: result.addresses.USDT_TRC20,
          btc: result.addresses.BTC,
          ltc: result.addresses.LTC,
          // Cross-compatible keys for UI components
          BTC: result.addresses.BTC,
          ETH: result.addresses.ETH,
          LTC: result.addresses.LTC,
          USDT_ERC20: result.addresses.USDT_ERC20,
          USDT_BEP20: result.addresses.USDT_BEP20,
          USDT_TRC20: result.addresses.USDT_TRC20,
        },
        userId: result.userId,
        walletIndex: result.walletIndex,
        profile: result.profile || null,
        records: result.records,
        metadata: result.metadata,
      });
    }

    // 5. Fallback for unauthenticated/preview state: deterministic index 1 addresses
    const defaultAddresses = deriveAllAddresses(1);

    return NextResponse.json({
      success: true,
      authenticated: false,
      wallet_index: 1,
      addresses: {
        evm: defaultAddresses.ETH,
        tron: defaultAddresses.USDT_TRC20,
        btc: defaultAddresses.BTC,
        ltc: defaultAddresses.LTC,
        BTC: defaultAddresses.BTC,
        ETH: defaultAddresses.ETH,
        LTC: defaultAddresses.LTC,
        USDT_ERC20: defaultAddresses.USDT_ERC20,
        USDT_BEP20: defaultAddresses.USDT_BEP20,
        USDT_TRC20: defaultAddresses.USDT_TRC20,
      },
      walletIndex: 1,
      profile: null,
      metadata: {
        btcDerivationPath: "m/84'/0'/0'/0/1",
        ethDerivationPath: "m/44'/60'/0'/0/1",
        ltcDerivationPath: "m/84'/2'/0'/0/1",
        tronDerivationPath: "m/44'/195'/0'/0/1",
        evmAddressReusedFor: ['ETH', 'USDT_ERC20', 'USDT_BEP20'],
        allowedChainNetworks: ['ethereum', 'arbitrum', 'base', 'polygon', 'bitcoin', 'ERC20', 'BEP20', 'TRC20'],
        derivedAt: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[GET /api/wallet/deposit-addresses] Error:', errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
