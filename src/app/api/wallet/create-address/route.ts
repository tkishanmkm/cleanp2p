import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, assetSymbol } = body;

    if (!userId || !assetSymbol) {
      return NextResponse.json(
        { success: false, error: 'Missing userId or assetSymbol' },
        { status: 400 }
      );
    }

    const symbol = assetSymbol.toUpperCase();

    // 1. Check if wallet already exists
    const { data: existingWallet } = await supabaseAdmin
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId)
      .eq('asset_symbol', symbol)
      .maybeSingle();

    if (existingWallet) {
      return NextResponse.json({ success: true, wallet: existingWallet });
    }

    // 2. Generate new wallet address
    const randomWallet = ethers.Wallet.createRandom();
    const depositAddress = randomWallet.address;

    // 3. Save to user_wallets table
    const { data: newWallet, error: insertError } = await supabaseAdmin
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
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Server Error' },
      { status: 500 }
    );
  }
}
