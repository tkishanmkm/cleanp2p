import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const assetSymbol = (body.assetSymbol || body.asset || 'USDT').toUpperCase();
    const amount = Number(body.amount);

    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ success: false, error: 'Valid positive amount is required' }, { status: 400 });
    }

    // 2. Fetch or create user wallet and credit balance
    const { data: existingWallet } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', user.id)
      .eq('asset_symbol', assetSymbol)
      .maybeSingle();

    if (existingWallet) {
      const newBalance = Number(existingWallet.balance || 0) + amount;
      const { data, error } = await supabase
        .from('user_wallets')
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq('id', existingWallet.id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, wallet: data });
    } else {
      const { data, error } = await supabase
        .from('user_wallets')
        .insert({
          user_id: user.id,
          asset_symbol: assetSymbol,
          balance: amount,
          locked_balance: 0,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, wallet: data });
    }
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
