import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { CryptoCurrency } from '@/lib/types';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paramUserId = searchParams.get('userId') || searchParams.get('user_id');

    const supabase = await createClient();

    // 1. Authenticate User Session
    let effectiveUserId: string | null = null;
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        effectiveUserId = user.id;
      }
    } catch {
      // Session fetch failed or not present
    }

    // Never trust a client-supplied user ID for balance reads. The authenticated
    // session is the sole source of identity; mismatched IDs are rejected.
    if (effectiveUserId && paramUserId && paramUserId !== effectiveUserId) {
      return NextResponse.json(
        { success: false, error: 'Forbidden: cannot read another user wallet' },
        { status: 403 }
      );
    }

    if (!effectiveUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: User not found' },
        { status: 401 }
      );
    }

    const supabaseAdmin = getSupabaseAdminClient();

    const balanceMap: Record<CryptoCurrency, { available: number; inEscrow: number; inWithdrawal: number; total: number }> = {
      BTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
      ETH: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
      LTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
      USDT: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
      BNB: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
      TRX: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0 },
    };

    const coins: CryptoCurrency[] = ['BTC', 'ETH', 'LTC', 'USDT', 'BNB', 'TRX'];

    // 1. Calculate real-time active escrow locked from seller's active trades
    const activeEscrowMap: Record<CryptoCurrency, number> = {
      BTC: 0,
      ETH: 0,
      LTC: 0,
      USDT: 0,
      BNB: 0,
      TRX: 0,
    };

    try {
      const { data: activeTrades } = await supabaseAdmin
        .from('trades')
        .select('crypto, coin, asset, amount, crypto_amount, escrow_fee, platform_fee, status, escrow_status')
        .eq('seller_id', effectiveUserId);

      if (activeTrades && activeTrades.length > 0) {
        const terminalStatuses = ['completed', 'cancelled', 'canceled', 'refunded', 'released', 'closed', 'expired', 'settled', 'resolved'];
        activeTrades.forEach((t: any) => {
          const st = String(t.status || '').toLowerCase().trim();
          const escrowSt = String(t.escrow_status || '').toLowerCase().trim();
          
          const isNonTerminal = !terminalStatuses.includes(st) && st !== '';
          const isEscrowLocked = escrowSt === 'locked' || escrowSt === 'in_escrow' || escrowSt === 'held';
          
          if (isNonTerminal || isEscrowLocked) {
            const rawCoin = String(t.crypto || t.coin || t.asset || 'USDT').toUpperCase();
            const sym = (coins.includes(rawCoin as CryptoCurrency) ? rawCoin : 'USDT') as CryptoCurrency;
            const cryptoAmt = Number(t.crypto_amount ?? t.amount ?? 0);
            const feeAmt = Number(t.escrow_fee ?? t.platform_fee ?? (cryptoAmt * 0.015));
            const totalTradeLock = cryptoAmt + feeAmt;
            if (totalTradeLock > 0) {
              activeEscrowMap[sym] = (activeEscrowMap[sym] || 0) + totalTradeLock;
            }
          }
        });
      }

      // Also query p2p_trades table if present
      const { data: p2pTrades } = await supabaseAdmin
        .from('p2p_trades')
        .select('crypto, coin, asset, amount, crypto_amount, escrow_fee, platform_fee, status, escrow_status')
        .eq('seller_id', effectiveUserId);

      if (p2pTrades && p2pTrades.length > 0) {
        const terminalStatuses = ['completed', 'cancelled', 'canceled', 'refunded', 'released', 'closed', 'expired', 'settled', 'resolved'];
        p2pTrades.forEach((t: any) => {
          const st = String(t.status || '').toLowerCase().trim();
          const escrowSt = String(t.escrow_status || '').toLowerCase().trim();
          const isNonTerminal = !terminalStatuses.includes(st) && st !== '';
          const isEscrowLocked = escrowSt === 'locked' || escrowSt === 'in_escrow' || escrowSt === 'held';
          if (isNonTerminal || isEscrowLocked) {
            const rawCoin = String(t.crypto || t.coin || t.asset || 'USDT').toUpperCase();
            const sym = (coins.includes(rawCoin as CryptoCurrency) ? rawCoin : 'USDT') as CryptoCurrency;
            const cryptoAmt = Number(t.crypto_amount ?? t.amount ?? 0);
            const feeAmt = Number(t.escrow_fee ?? t.platform_fee ?? (cryptoAmt * 0.015));
            const totalTradeLock = cryptoAmt + feeAmt;
            if (totalTradeLock > 0) {
              activeEscrowMap[sym] = (activeEscrowMap[sym] || 0) + totalTradeLock;
            }
          }
        });
      }
    } catch (err) {
      console.warn('Active trades escrow query notice:', err);
    }

    // 2. PRIMARY: Fetch from wallet_assets (authoritative single source of truth)
    const hasWalletAssets: Record<CryptoCurrency, boolean> = {
      BTC: false,
      ETH: false,
      LTC: false,
      USDT: false,
      BNB: false,
      TRX: false,
    };

    try {
      const { data: assetsByUserId } = await supabaseAdmin
        .from('wallet_assets')
        .select('user_id, asset_symbol, balance, locked_balance, reserved_balance, in_escrow, in_withdrawal')
        .eq('user_id', effectiveUserId);

      if (assetsByUserId && assetsByUserId.length > 0) {
        for (const row of assetsByUserId) {
          const rawSymbol = String(row.asset_symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) continue;

          hasWalletAssets[symbol] = true;
          const normalized = normalizePrimaryWalletAssetBalance(row, activeEscrowMap[symbol]);
          balanceMap[symbol] = normalized;
        }
      }
    } catch (err) {
      console.warn('wallet_assets primary query notice:', err);
    }

    // No legacy balances/user_balances/user_wallets/profile columns are authoritative.
    // If a wallet_assets row is not initialized, the spendable balance remains zero.

    // 7. Ensure active escrow is accurately recorded and sync other tables
    coins.forEach((coin) => {
      const activeEscrow = activeEscrowMap[coin] || 0;
      if (activeEscrow > balanceMap[coin].inEscrow) {
        // The wallet_assets spendable balance was already debited when escrow was reserved.
        // Raise only the displayed escrow liability; do not debit available a second time.
        balanceMap[coin].inEscrow = activeEscrow;
      }
      balanceMap[coin].total = balanceMap[coin].available + balanceMap[coin].inEscrow + balanceMap[coin].inWithdrawal;
    });

    const formattedList = coins.map((coin) => ({
      asset_symbol: coin,
      available: balanceMap[coin].available,
      balance: balanceMap[coin].available,
      locked: balanceMap[coin].inEscrow,
      locked_balance: balanceMap[coin].inEscrow,
      locked_escrow: balanceMap[coin].inEscrow,
      locked_withdrawal: balanceMap[coin].inWithdrawal,
      total_balance: balanceMap[coin].total,
      total: balanceMap[coin].total,
    }));

    return NextResponse.json({
      success: true,
      balances: balanceMap,
      wallets: formattedList,
    });
  } catch (err: any) {
    console.error('Unhandled balance fetch error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
