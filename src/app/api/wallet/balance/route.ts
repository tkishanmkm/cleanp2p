import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { CryptoCurrency } from '@/lib/types';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type WalletBalance = {
  available: number;
  reserved: number;
  inEscrow: number;
  inWithdrawal: number;
  total: number;
};

const SUPPORTED_COINS: CryptoCurrency[] = ['BTC', 'ETH', 'LTC', 'USDT', 'BNB', 'TRX'];

function emptyBalance(): WalletBalance {
  return { available: 0, reserved: 0, inEscrow: 0, inWithdrawal: 0, total: 0 };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paramUserId = searchParams.get('userId') || searchParams.get('user_id');
    const sessionClient = await createClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();

    if (authError || !user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: User not found' },
        { status: 401 }
      );
    }

    // Never trust a client-supplied user ID for balance reads.
    if (paramUserId && paramUserId !== user.id) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: cannot read another user wallet' },
        { status: 403 }
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: assetRows, error: assetError } = await admin
      .from('wallet_assets')
      .select('user_id,asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal')
      .eq('user_id', user.id)
      .order('asset_symbol', { ascending: true });

    if (assetError || !Array.isArray(assetRows)) {
      console.error('[WALLET_BALANCE] Canonical wallet asset query failed:', assetError?.code || 'invalid_response');
      return NextResponse.json(
        { success: false, error: 'Canonical wallet balances are temporarily unavailable.' },
        { status: 503 }
      );
    }

    const balances: Record<CryptoCurrency, WalletBalance> = {
      BTC: emptyBalance(),
      ETH: emptyBalance(),
      LTC: emptyBalance(),
      USDT: emptyBalance(),
      BNB: emptyBalance(),
      TRX: emptyBalance(),
    };
    const seenAssets = new Set<CryptoCurrency>();

    for (const row of assetRows) {
      const rawSymbol = String(row.asset_symbol || '').trim().toUpperCase();
      if (!SUPPORTED_COINS.includes(rawSymbol as CryptoCurrency)) continue;

      const symbol = rawSymbol as CryptoCurrency;
      if (seenAssets.has(symbol)) {
        console.error('[WALLET_BALANCE] Duplicate canonical wallet asset row encountered.');
        return NextResponse.json(
          { success: false, error: 'Wallet balance reconciliation is required.' },
          { status: 503 }
        );
      }

      const normalized = normalizePrimaryWalletAssetBalance(row);
      if (!normalized.accountingValid) {
        console.error('[WALLET_BALANCE] Invalid or inconsistent canonical accounting buckets encountered.');
        return NextResponse.json(
          { success: false, error: 'Wallet balance reconciliation is required.' },
          { status: 503 }
        );
      }

      seenAssets.add(symbol);
      balances[symbol] = {
        available: normalized.available,
        reserved: normalized.reserved,
        inEscrow: normalized.inEscrow,
        inWithdrawal: normalized.inWithdrawal,
        total: normalized.total,
      };
    }

    const wallets = SUPPORTED_COINS.map((coin) => ({
      asset_symbol: coin,
      available: balances[coin].available,
      balance: balances[coin].available,
      reserved_balance: balances[coin].reserved,
      locked: balances[coin].inEscrow,
      locked_balance: balances[coin].reserved,
      locked_escrow: balances[coin].inEscrow,
      locked_withdrawal: balances[coin].inWithdrawal,
      total_balance: balances[coin].total,
      total: balances[coin].total,
    }));

    return NextResponse.json(
      { success: true, balances, wallets },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error: unknown) {
    console.error(
      '[WALLET_BALANCE] Unhandled balance fetch error:',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return NextResponse.json(
      { success: false, error: 'Canonical wallet balances are temporarily unavailable.' },
      { status: 500 }
    );
  }
}
