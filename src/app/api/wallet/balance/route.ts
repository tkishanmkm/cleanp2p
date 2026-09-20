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
        .select('crypto, amount, crypto_amount, escrow_fee, platform_fee, status, escrow_status')
        .eq('seller_id', effectiveUserId)
        .in('status', ['active', 'pending', 'paid', 'buyer_marked_paid', 'payment_sent', 'disputed', 'ACTIVE', 'PENDING', 'PAID', 'DISPUTED']);

      if (activeTrades && activeTrades.length > 0) {
        activeTrades.forEach((t: any) => {
          const rawCoin = String(t.crypto || t.coin || 'USDT').toUpperCase();
          const sym = (coins.includes(rawCoin as CryptoCurrency) ? rawCoin : 'USDT') as CryptoCurrency;
          const cryptoAmt = Number(t.crypto_amount ?? t.amount ?? 0);
          const feeAmt = Number(t.escrow_fee ?? t.platform_fee ?? (cryptoAmt * 0.015));
          const totalTradeLock = cryptoAmt + feeAmt;
          if (totalTradeLock > 0) {
            activeEscrowMap[sym] = (activeEscrowMap[sym] || 0) + totalTradeLock;
          }
        });
      }
    } catch (err) {
      console.warn('Active trades escrow query notice:', err);
    }

    // 2. Fetch primary from balances table
    try {
      const { data: balancesTableData } = await supabaseAdmin
        .from('balances')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (balancesTableData && balancesTableData.length > 0) {
        balancesTableData.forEach((row: any) => {
          rawRecords.push(row);
          const rawSymbol = String(row.asset || row.asset_symbol || row.symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) return;

          const avail = Number(row.available_balance ?? row.available ?? row.balance ?? 0);
          const escrow = Math.max(Number(row.locked_balance ?? row.locked ?? row.in_escrow ?? 0), activeEscrowMap[symbol]);
          const withdraw = Number(row.locked_withdrawal ?? 0);
          const total = Number(row.total_balance ?? (avail + escrow + withdraw));

          balanceMap[symbol] = {
            available: Math.max(0, avail),
            inEscrow: Math.max(balanceMap[symbol].inEscrow, escrow),
            inWithdrawal: Math.max(balanceMap[symbol].inWithdrawal, withdraw),
            total: Math.max(balanceMap[symbol].total, total),
          };
        });
      }
    } catch (err) {
      console.warn('balances table query notice:', err);
    }

    // 3. Fetch from user_balances table
    try {
      const { data: userBalancesData } = await supabaseAdmin
        .from('user_balances')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (userBalancesData && userBalancesData.length > 0) {
        userBalancesData.forEach((row: any) => {
          rawRecords.push(row);
          const rawSymbol = String(row.asset || row.asset_symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) return;

          const avail = Number(row.available_balance ?? 0);
          const escrow = Math.max(Number(row.locked_balance ?? 0), activeEscrowMap[symbol]);
          const total = avail + escrow;

          if (balanceMap[symbol].total === 0 || total > balanceMap[symbol].total) {
            balanceMap[symbol].total = total;
          }
          if (escrow > balanceMap[symbol].inEscrow) {
            balanceMap[symbol].inEscrow = escrow;
          }
          balanceMap[symbol].available = Math.max(0, avail);
        });
      }
    } catch (err) {
      console.warn('user_balances table query notice:', err);
    }

    // 4. Fetch from wallet_assets
    try {
      const { data: assetsByUserId } = await supabaseAdmin
        .from('wallet_assets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (assetsByUserId && assetsByUserId.length > 0) {
        assetsByUserId.forEach((row: any) => {
          rawRecords.push(row);
          const rawSymbol = String(row.asset_symbol || row.asset_code || row.symbol || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) return;

          const avail = Number(row.available ?? row.available_balance ?? row.balance ?? 0);
          const escrow = Math.max(Number(row.locked_escrow ?? row.locked_balance ?? row.locked ?? 0), activeEscrowMap[symbol]);
          const withdraw = Number(row.locked_withdrawal ?? 0);
          const total = Number(row.total_balance ?? (avail + escrow + withdraw));

          if (balanceMap[symbol].total === 0) {
            balanceMap[symbol].total = total;
          }
          if (escrow > balanceMap[symbol].inEscrow) {
            balanceMap[symbol].inEscrow = escrow;
          }
          if (balanceMap[symbol].available === 0 && avail > 0) {
            balanceMap[symbol].available = avail;
          }
        });
      }
    } catch (err) {
      console.warn('wallet_assets query notice:', err);
    }

    // 5. Fetch from user_wallets
    try {
      const { data: userWalletsView } = await supabaseAdmin
        .from('user_wallets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (userWalletsView && userWalletsView.length > 0) {
        userWalletsView.forEach((row: any) => {
          rawRecords.push(row);
          const rawSymbol = String(row.asset_symbol || row.asset_code || '').toUpperCase();
          const symbol = (coins.includes(rawSymbol as CryptoCurrency) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) return;

          const avail = Number(row.available_balance ?? row.balance ?? 0);
          const escrow = Math.max(Number(row.locked_balance ?? row.reserved_balance ?? 0), activeEscrowMap[symbol]);
          const total = Number(row.total_balance ?? (avail + escrow));

          if (balanceMap[symbol].total === 0) {
            balanceMap[symbol].total = total;
          }
          if (escrow > balanceMap[symbol].inEscrow) {
            balanceMap[symbol].inEscrow = escrow;
          }
          if (balanceMap[symbol].available === 0 && avail > 0) {
            balanceMap[symbol].available = avail;
          }
        });
      }
    } catch (err) {
      console.warn('user_wallets query notice:', err);
    }

    // 6. Fetch from profiles table fallback
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

        if (btc > 0 && balanceMap['BTC'].total === 0) {
          balanceMap['BTC'].total = btc;
          balanceMap['BTC'].available = btc;
        }
        if (eth > 0 && balanceMap['ETH'].total === 0) {
          balanceMap['ETH'].total = eth;
          balanceMap['ETH'].available = eth;
        }
        if (ltc > 0 && balanceMap['LTC'].total === 0) {
          balanceMap['LTC'].total = ltc;
          balanceMap['LTC'].available = ltc;
        }
        if (usdt > 0 && balanceMap['USDT'].total === 0) {
          balanceMap['USDT'].total = usdt;
          balanceMap['USDT'].available = usdt;
        }
      }
    } catch (err) {
      console.warn('profiles query notice:', err);
    }

    // 7. Strict Authoritative Final Pass:
    // available = Math.max(0, total - inEscrow - inWithdrawal)
    // If locked in escrow, available MUST be reduced by the exact locked amount!
    coins.forEach((coin) => {
      const activeEscrow = activeEscrowMap[coin] || 0;
      if (activeEscrow > balanceMap[coin].inEscrow) {
        balanceMap[coin].inEscrow = activeEscrow;
      }

      // If total was recorded lower than (available + escrow), update total
      if (balanceMap[coin].total < (balanceMap[coin].available + balanceMap[coin].inEscrow)) {
        balanceMap[coin].total = balanceMap[coin].available + balanceMap[coin].inEscrow;
      }

      // Enforce: available cannot exceed (total - inEscrow - inWithdrawal)
      const maxSpendable = Math.max(0, balanceMap[coin].total - balanceMap[coin].inEscrow - balanceMap[coin].inWithdrawal);
      balanceMap[coin].available = Math.min(balanceMap[coin].available, maxSpendable);
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
