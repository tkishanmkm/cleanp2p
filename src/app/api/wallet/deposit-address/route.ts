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

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    let targetUserId: string | null = null;

    // 1. Check Bearer Authorization header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data } = await supabaseAdmin.auth.getUser(token);
        if (data?.user?.id) {
          targetUserId = data.user.id;
        }
      } catch {
        // Fallback
      }
    }

    // 2. Check Cookie Authentication
    if (!targetUserId && supabaseUrl && supabaseAnonKey) {
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
          targetUserId = user.id;
        }
      } catch {
        // Fallback
      }
    }

    // 3. Check query param user_id
    const { searchParams } = new URL(req.url);
    const queryUserId = searchParams.get('user_id');
    if (queryUserId && !targetUserId) {
      targetUserId = queryUserId;
    }

    // 4. Fetch or query profile
    let profileQuery = supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, btc_deposit_address, tron_deposit_address, ltc_deposit_address');

    if (targetUserId) {
      profileQuery = profileQuery.eq('id', targetUserId);
    }

    const { data: profile, error: profileError } = await profileQuery.limit(1).maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    const walletIndex = profile.wallet_index ?? 0;
    let evmAddress = profile.evm_deposit_address;
    let btcAddress = profile.btc_deposit_address;
    let tronAddress = profile.tron_deposit_address;
    let ltcAddress = profile.ltc_deposit_address;

    // 5. Derive HD keys if missing address
    if (!evmAddress || !btcAddress || !tronAddress || !ltcAddress) {
      try {
        const keys = await deriveUserKeys(SYSTEM_CONFIG.mnemonic, walletIndex);
        evmAddress = evmAddress || keys.evm.address;
        btcAddress = btcAddress || keys.btc.address;
        tronAddress = tronAddress || keys.tron.address;
        ltcAddress = ltcAddress || keys.ltc.address;

        await supabaseAdmin
          .from('profiles')
          .update({
            evm_deposit_address: evmAddress,
            btc_deposit_address: btcAddress,
            tron_deposit_address: tronAddress,
            ltc_deposit_address: ltcAddress,
          })
          .eq('id', profile.id);
      } catch (deriveErr) {
        console.warn('HD Derivation note:', deriveErr);
      }
    }

    return NextResponse.json({
      success: true,
      wallet_index: walletIndex,
      addresses: {
        evm: evmAddress,
        btc: btcAddress,
        tron: tronAddress,
        ltc: ltcAddress,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error occurred';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
