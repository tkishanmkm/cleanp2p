import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();

    // 1. Authenticate Request
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch Wallet Balances safely
    let availableBalance = 0;
    let assetSymbol = 'USDT';
    let lastUpdated: string | null = null;

    // Check wallet_assets first
    const { data: assetRow } = await supabase
      .from('wallet_assets')
      .select('*')
      .eq('user_id', user.id)
      .eq('asset_symbol', 'USDT')
      .maybeSingle();

    if (assetRow) {
      const avail = Number(assetRow.available ?? assetRow.balance ?? 0);
      const locked = Number(assetRow.locked_escrow ?? assetRow.locked_balance ?? 0);
      availableBalance = Math.max(0, avail - locked);
      assetSymbol = assetRow.asset_symbol || 'USDT';
      lastUpdated = assetRow.updated_at || null;
    } else {
      // Check user_wallets
      const { data: userWallet } = await supabase
        .from('user_wallets')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_symbol', 'USDT')
        .maybeSingle();

      if (userWallet) {
        const bal = Number(userWallet.balance || 0);
        const locked = Number(userWallet.locked_balance || 0);
        availableBalance = Math.max(0, bal - locked);
        assetSymbol = userWallet.asset_symbol || 'USDT';
        lastUpdated = userWallet.updated_at || null;
      } else {
        // Check wallets table
        const { data: wallet } = await supabase
          .from('wallets')
          .select('user_id, currency, balance, available_balance, created_at')
          .eq('user_id', user.id)
          .maybeSingle();

        if (wallet) {
          availableBalance = Number(wallet.available_balance ?? wallet.balance ?? 0);
          assetSymbol = wallet.currency || 'USDT';
          lastUpdated = wallet.created_at || null;
        }
      }
    }

    // 3. Return Sanitized Available Balance to Frontend
    return NextResponse.json({
      userId: user.id,
      asset_symbol: assetSymbol,
      currency: assetSymbol,
      balance: Math.max(0, availableBalance),
      availableBalance: Math.max(0, availableBalance).toFixed(8),
      lastUpdated: wallet?.updated_at || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
