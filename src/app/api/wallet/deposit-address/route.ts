import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    const supabaseAdmin = getSupabaseAdminClient();

    let userId: string | null = null;

    // Check authorization header
    const authHeader = req.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      try {
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (!error && data?.user) {
          userId = data.user.id;
        }
      } catch {
        // Fallback
      }
    }

    if (!userId) {
      const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
        },
      });
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }

    // Default or mock addresses if unauthenticated or new
    let evmAddress = process.env.EVM_HOT_WALLET_ADDRESS || '0x71C80a6c6a46C652136e095b3d5bfa780d6D33A4';
    let btcAddress = process.env.BTC_HOT_WALLET_ADDRESS || 'bc1q9d6g9m37t5tq3x4796j9p4y0q9c5p8w4n5g6m7';

    if (userId) {
      const { data: addresses } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('address, network, asset_symbol')
        .eq('user_id', userId);

      if (addresses && addresses.length > 0) {
        const evm = addresses.find((a) => ['ethereum', 'arbitrum', 'base', 'polygon', 'evm', 'ETH', 'USDT'].includes(a.network) || a.address?.startsWith('0x'));
        const btc = addresses.find((a) => ['bitcoin', 'btc', 'BTC'].includes(a.network) || a.address?.startsWith('bc1') || a.address?.startsWith('1') || a.address?.startsWith('3'));
        
        if (evm?.address) evmAddress = evm.address;
        if (btc?.address) btcAddress = btc.address;
      }
    }

    return NextResponse.json({
      success: true,
      wallet: {
        evm_address: evmAddress,
        btc_address: btcAddress,
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      wallet: {
        evm_address: '0x71C80a6c6a46C652136e095b3d5bfa780d6D33A4',
        btc_address: 'bc1q9d6g9m37t5tq3x4796j9p4y0q9c5p8w4n5g6m7',
      },
      error: err.message,
    });
  }
}
