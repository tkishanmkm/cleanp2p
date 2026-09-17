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

    // 2. Fetch Wallet Balances
    const { data: wallet, error: walletErr } = await supabase
      .from('wallets')
      .select('user_id, currency, balance, reserved_balance, locked_balance, available_balance, updated_at')
      .eq('user_id', user.id)
      .single();

    if (walletErr && walletErr.code !== 'PGRST116') {
      return NextResponse.json({ error: walletErr.message }, { status: 500 });
    }

    const total = Number(wallet?.balance || 0);
    const locked = Number(wallet?.locked_balance ?? wallet?.reserved_balance ?? 0);
    const availableBalance = Number(wallet?.available_balance ?? (total - locked));
    const assetSymbol = wallet?.currency || 'USDT';

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
