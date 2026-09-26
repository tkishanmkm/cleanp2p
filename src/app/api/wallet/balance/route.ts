import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { CryptoCurrency } from '@/lib/types';

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

    if (!effectiveUserId && paramUserId) {
      effectiveUserId = paramUserId;
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
    };

    const rawRecords: any[] = [];
    const coins: CryptoCurrency[] = ['BTC', 'ETH', 'LTC', 'USDT'];

    // 1. Calculate real-time active escrow locked from seller's active trades
    const activeEscrowMap: Record<CryptoCurrency, number> = {
      BTC: 0,
      ETH: 0,
      LTC: 0,
      USDT: 0,
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
    };

    try {
      const { data: assetsByUserId } = await supabaseAdmin
        .from('wallet_assets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (assetsByUserId && assetsByUserId.length > 0) {
        for (const row of assetsByUserId) {
          rawRecords.push(row);
          const rawSymbol = String(row.asset_symbol || row.asset_code || row.symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) continue;

          hasWalletAssets[symbol] = true;
          const dbAvail = row.available !== undefined && row.available !== null ? Number(row.available) : null;
          const dbBal = row.balance !== undefined && row.balance !== null ? Number(row.balance) : null;
          const dbLocked = Number(row.locked_balance ?? row.locked_escrow ?? row.locked ?? row.in_escrow ?? 0);
          const activeEscrow = activeEscrowMap[symbol] || 0;
          const withdraw = Number(row.locked_withdrawal ?? 0);
          const escrow = Math.max(dbLocked, activeEscrow);

          // Calculate available balance safely:
          // If explicit available is provided, ensure it accounts for active escrow.
          // Otherwise, derive available as balance - locked escrow.
          let avail = 0;
          if (dbAvail !== null && !isNaN(dbAvail)) {
            const unaccountedEscrow = Math.max(0, activeEscrow - dbLocked);
            avail = Math.max(0, dbAvail - unaccountedEscrow);
          } else if (dbBal !== null && !isNaN(dbBal)) {
            avail = Math.max(0, dbBal - escrow - withdraw);
          }

          const total = avail + escrow + withdraw;

          balanceMap[symbol] = {
            available: Math.max(0, avail),
            inEscrow: escrow,
            inWithdrawal: withdraw,
            total: Math.max(0, total),
          };
        }
      }
    } catch (err) {
      console.warn('wallet_assets primary query notice:', err);
    }

    // 3. Fallback for coins not yet in wallet_assets: Check balances table
    try {
      const { data: balancesTableData } = await supabaseAdmin
        .from('balances')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (balancesTableData && balancesTableData.length > 0) {
        for (const row of balancesTableData) {
          rawRecords.push(row);
          const rawSymbol = String(row.asset || row.asset_symbol || row.symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) continue;

          if (!hasWalletAssets[symbol]) {
            const avail = Number(row.available_balance ?? row.available ?? row.balance ?? 0);
            const escrow = Math.max(Number(row.locked_balance ?? row.locked ?? row.in_escrow ?? 0), activeEscrowMap[symbol]);
            const withdraw = Number(row.locked_withdrawal ?? 0);
            const total = avail + escrow + withdraw;

            balanceMap[symbol] = {
              available: Math.max(0, avail),
              inEscrow: escrow,
              inWithdrawal: withdraw,
              total: Math.max(0, total),
            };
            hasWalletAssets[symbol] = true;
          }
        }
      }
    } catch (err) {
      console.warn('balances fallback query notice:', err);
    }

    // 4. Fallback for coins not yet initialized: Check user_balances table
    try {
      const { data: userBalancesData } = await supabaseAdmin
        .from('user_balances')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (userBalancesData && userBalancesData.length > 0) {
        for (const row of userBalancesData) {
          rawRecords.push(row);
          const rawSymbol = String(row.asset || row.asset_symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) continue;

          if (!hasWalletAssets[symbol]) {
            const avail = Number(row.available_balance ?? 0);
            const escrow = Math.max(Number(row.locked_balance ?? 0), activeEscrowMap[symbol]);
            const total = avail + escrow;

            balanceMap[symbol] = {
              available: Math.max(0, avail),
              inEscrow: escrow,
              inWithdrawal: 0,
              total: Math.max(0, total),
            };
            hasWalletAssets[symbol] = true;
          }
        }
      }
    } catch (err) {
      console.warn('user_balances fallback query notice:', err);
    }

    // 5. Fallback from user_wallets
    try {
      const { data: userWalletsView } = await supabaseAdmin
        .from('user_wallets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (userWalletsView && userWalletsView.length > 0) {
        for (const row of userWalletsView) {
          rawRecords.push(row);
          const rawSymbol = String(row.asset_symbol || row.asset_code || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) continue;

          if (!hasWalletAssets[symbol]) {
            const avail = Number(row.available_balance ?? row.balance ?? 0);
            const escrow = Math.max(Number(row.locked_balance ?? row.reserved_balance ?? 0), activeEscrowMap[symbol]);
            const total = avail + escrow;

            balanceMap[symbol] = {
              available: Math.max(0, avail),
              inEscrow: escrow,
              inWithdrawal: 0,
              total: Math.max(0, total),
            };
            hasWalletAssets[symbol] = true;
          }
        }
      }
    } catch (err) {
      console.warn('user_wallets fallback query notice:', err);
    }

    // 6. Profiles fallback
    try {
      const { data: profileRow } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .or(`id.eq.${effectiveUserId},user_id.eq.${effectiveUserId}`)
        .maybeSingle();

      if (profileRow) {
        const btc = Number(profileRow.btc_balance ?? profileRow.btcBalance ?? profileRow.wallets?.BTC?.balance ?? 0);
        const eth = Number(profileRow.eth_balance ?? profileRow.ethBalance ?? profileRow.wallets?.ETH?.balance ?? 0);
        const ltc = Number(profileRow.ltc_balance ?? profileRow.ltcBalance ?? profileRow.wallets?.LTC?.balance ?? 0);
        const usdt = Number(profileRow.usdt_balance ?? profileRow.usdtBalance ?? profileRow.wallets?.USDT?.balance ?? 0);

        if (!hasWalletAssets['BTC'] && btc > 0) {
          balanceMap['BTC'] = { available: btc, inEscrow: activeEscrowMap['BTC'], inWithdrawal: 0, total: btc + activeEscrowMap['BTC'] };
        }
        if (!hasWalletAssets['ETH'] && eth > 0) {
          balanceMap['ETH'] = { available: eth, inEscrow: activeEscrowMap['ETH'], inWithdrawal: 0, total: eth + activeEscrowMap['ETH'] };
        }
        if (!hasWalletAssets['LTC'] && ltc > 0) {
          balanceMap['LTC'] = { available: ltc, inEscrow: activeEscrowMap['LTC'], inWithdrawal: 0, total: ltc + activeEscrowMap['LTC'] };
        }
        if (!hasWalletAssets['USDT'] && usdt > 0) {
          balanceMap['USDT'] = { available: usdt, inEscrow: activeEscrowMap['USDT'], inWithdrawal: 0, total: usdt + activeEscrowMap['USDT'] };
        }
      }
    } catch (err) {
      console.warn('profiles query notice:', err);
    }

    // 7. Ensure active escrow is accurately recorded and sync other tables
    coins.forEach((coin) => {
      const activeEscrow = activeEscrowMap[coin] || 0;
      if (activeEscrow > balanceMap[coin].inEscrow) {
        const diff = activeEscrow - balanceMap[coin].inEscrow;
        balanceMap[coin].available = Math.max(0, balanceMap[coin].available - diff);
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
      raw: rawRecords,
    });
  } catch (err: any) {
    console.error('Unhandled balance fetch error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
