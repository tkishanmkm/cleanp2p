import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { deriveUserWallets } from '@/lib/crypto/hdWallet';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Fetch user profile to get claimed wallet_index
    const { data: profile, error: fetchErr } = await supabaseAdmin
      .from('profiles')
      .select('id, wallet_index, evm_deposit_address, tron_deposit_address, btc_deposit_address, ltc_deposit_address')
      .eq('id', userId)
      .single();

    if (fetchErr || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Skip if addresses are already provisioned
    if (profile.evm_deposit_address) {
      return NextResponse.json({ 
        message: 'Wallets already provisioned',
        walletIndex: profile.wallet_index,
        addresses: {
          evm: profile.evm_deposit_address,
          tron: profile.tron_deposit_address,
          btc: profile.btc_deposit_address,
          ltc: profile.ltc_deposit_address,
        }
      });
    }

    // Derive deterministically using claimed index
    const derived = deriveUserWallets(profile.wallet_index ?? 0);

    // Update profile with on-chain deposit addresses
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({
        evm_deposit_address: derived.evmAddress,
        tron_deposit_address: derived.tronAddress,
        btc_deposit_address: derived.btcAddress,
        ltc_deposit_address: derived.ltcAddress,
      })
      .eq('id', userId);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      success: true,
      walletIndex: profile.wallet_index,
      addresses: {
        evm: derived.evmAddress,
        tron: derived.tronAddress,
        btc: derived.btcAddress,
        ltc: derived.ltcAddress,
      }
    });
  } catch (err: any) {
    console.error('[Wallet Provisioning Error]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
