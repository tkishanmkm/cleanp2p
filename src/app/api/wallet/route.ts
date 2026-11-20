import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // wallet_assets.balance is already the spendable amount. Escrow, reserve
    // and withdrawal balances are separate buckets and must not be subtracted
    // from it a second time. Legacy wallet tables are not balance fallbacks.
    const { data: assetRow, error: assetError } = await supabase
      .from('wallet_assets')
      .select('asset_symbol,balance,updated_at')
      .eq('user_id', user.id)
      .eq('asset_symbol', 'USDT')
      .maybeSingle();

    if (assetError) {
      console.error('[WALLET] Canonical USDT asset lookup failed:', assetError.code || 'unknown');
      return NextResponse.json(
        { error: 'Canonical wallet balance is temporarily unavailable.' },
        { status: 503 }
      );
    }

    let availableBalance = 0;
    let assetSymbol = 'USDT';
    let lastUpdated: string | null = null;

    if (assetRow) {
      const balance = Number(assetRow.balance);
      if (!Number.isFinite(balance) || balance < 0) {
        console.error('[WALLET] Invalid canonical spendable balance encountered.');
        return NextResponse.json(
          { error: 'Wallet balance reconciliation is required.' },
          { status: 503 }
        );
      }

      availableBalance = balance;
      assetSymbol = assetRow.asset_symbol || 'USDT';
      lastUpdated = assetRow.updated_at || null;
    }

    return NextResponse.json({
      userId: user.id,
      asset_symbol: assetSymbol,
      currency: assetSymbol,
      balance: availableBalance,
      availableBalance: availableBalance.toFixed(8),
      lastUpdated,
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error: unknown) {
    console.error(
      '[WALLET] Unhandled wallet read error:',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return NextResponse.json(
      { error: 'Canonical wallet balance is temporarily unavailable.' },
      { status: 500 }
    );
  }
}
