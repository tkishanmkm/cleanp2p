import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate User Session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Fetch from wallet_assets with exact confirmed database schema
    const { data: walletAssets, error: assetsError } = await supabase
      .from('wallet_assets')
      .select('asset_symbol, available, locked, updated_at')
      .eq('user_id', user.id);

    if (!assetsError && walletAssets && walletAssets.length > 0) {
      return NextResponse.json({
        success: true,
        wallets: walletAssets.map((asset: any) => {
          const spendable = Number(asset.available ?? 0); // 'available', not 'balance' or 'amount'
          const symbol = String(asset.asset_symbol ?? '').toUpperCase(); // 'asset_symbol', not 'symbol' or 'asset_code'
          const lockedAmount = Number(asset.locked ?? 0);

          return {
            asset_symbol: symbol,
            available: spendable,
            balance: spendable,
            locked: lockedAmount,
            locked_balance: lockedAmount,
            updated_at: asset.updated_at,
          };
        }),
      });
    }

    // 3. Fallback to user_wallets if wallet_assets has no records yet
    const { data: wallets, error } = await supabase
      .from('user_wallets')
      .select('id, asset_symbol, balance, available_balance, locked_balance, deposit_address, updated_at')
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      wallets: (wallets || []).map((w: any) => {
        const spendable = Number(w.available_balance ?? w.balance ?? 0);
        const symbol = String(w.asset_symbol ?? '').toUpperCase();
        const lockedAmount = Number(w.locked_balance ?? 0);

        return {
          ...w,
          asset_symbol: symbol,
          available: spendable,
          balance: spendable,
          locked: lockedAmount,
          locked_balance: lockedAmount,
        };
      }),
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
