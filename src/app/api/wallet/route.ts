import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createRouteHandlerClient({ cookies });

    // 1. Authenticate Request
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch Wallet Balances
    const { data: wallet, error: walletErr } = await supabase
      .from('wallets')
      .select('user_id, currency, balance, reserved_balance, updated_at')
      .eq('user_id', user.id)
      .single();

    if (walletErr && walletErr.code !== 'PGRST116') {
      return NextResponse.json({ error: walletErr.message }, { status: 500 });
    }

    // 3. Return Balance Summary
    return NextResponse.json({
      userId: user.id,
      currency: wallet?.currency || 'USDT',
      availableBalance: wallet?.balance || '0.00000000',
      lockedBalance: wallet?.reserved_balance || '0.00000000',
      totalBalance: (
        parseFloat(wallet?.balance || '0') + parseFloat(wallet?.reserved_balance || '0')
      ).toFixed(8),
      lastUpdated: wallet?.updated_at || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
