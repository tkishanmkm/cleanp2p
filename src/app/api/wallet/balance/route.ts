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

    // Helper to process row
    const processRow = (row: any) => {
      if (!row) return;
      rawRecords.push(row);
      const rawSymbol = String(row.asset_symbol || row.asset_code || row.symbol || row.crypto || '').toUpperCase();
      const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSymbol) ? rawSymbol : null) as CryptoCurrency | null;
      if (!symbol) return;

      const avail = Number(row.available ?? row.available_balance ?? row.balance ?? row.main_balance ?? 0);
      const escrow = Number(row.locked ?? row.locked_balance ?? row.locked_escrow ?? row.in_escrow ?? 0);
      const withdraw = Number(row.locked_withdrawal ?? row.in_withdrawal ?? 0);
      const total = Number(row.total_balance ?? row.total ?? (avail + escrow + withdraw));

      balanceMap[symbol] = {
        available: Math.max(balanceMap[symbol].available, isNaN(avail) ? 0 : avail),
        inEscrow: Math.max(balanceMap[symbol].inEscrow, isNaN(escrow) ? 0 : escrow),
        inWithdrawal: Math.max(balanceMap[symbol].inWithdrawal, isNaN(withdraw) ? 0 : withdraw),
        total: Math.max(balanceMap[symbol].total, isNaN(total) ? (avail + escrow + withdraw) : total),
      };
    };

    // 1.5 Fetch from balances table (user_id, asset, available_balance, locked_balance, total_balance)
    try {
      const { data: balancesTableData } = await supabaseAdmin
        .from('balances')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (balancesTableData && balancesTableData.length > 0) {
        balancesTableData.forEach((row: any) => {
          rawRecords.push(row);
          const rawSymbol = String(row.asset || row.asset_symbol || row.symbol || '').toUpperCase();
          const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSymbol) ? rawSymbol : null) as CryptoCurrency | null;
          if (!symbol) return;

          const avail = Number(row.available_balance ?? row.available ?? row.balance ?? 0);
          const escrow = Number(row.locked_balance ?? row.locked ?? row.in_escrow ?? 0);
          const withdraw = Number(row.locked_withdrawal ?? 0);

          balanceMap[symbol] = {
            available: Math.max(balanceMap[symbol].available, isNaN(avail) ? 0 : avail),
            inEscrow: Math.max(balanceMap[symbol].inEscrow, isNaN(escrow) ? 0 : escrow),
            inWithdrawal: Math.max(balanceMap[symbol].inWithdrawal, isNaN(withdraw) ? 0 : withdraw),
            total: Math.max(balanceMap[symbol].total, avail + escrow + withdraw),
          };
        });
      }
    } catch (err) {
      console.warn('balances table query error:', err);
    }

    // 2. Fetch from wallet_assets by user_id
    try {
      const { data: assetsByUserId } = await supabaseAdmin
        .from('wallet_assets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (assetsByUserId && assetsByUserId.length > 0) {
        assetsByUserId.forEach(processRow);
      }
    } catch (err) {
      console.warn('wallet_assets by user_id query error:', err);
    }

    // 3. Fetch from wallets table and associated wallet_assets
    try {
      const { data: userWalletsTable } = await supabaseAdmin
        .from('wallets')
        .select('id')
        .eq('user_id', effectiveUserId);

      if (userWalletsTable && userWalletsTable.length > 0) {
        const walletIds = userWalletsTable.map((w: any) => w.id).filter(Boolean);
        if (walletIds.length > 0) {
          const { data: assetsByWalletId } = await supabaseAdmin
            .from('wallet_assets')
            .select('*')
            .in('wallet_id', walletIds);

          if (assetsByWalletId && assetsByWalletId.length > 0) {
            assetsByWalletId.forEach(processRow);
          }
        }
      }
    } catch (err) {
      console.warn('wallets relation query error:', err);
    }

    // 4. Fetch from user_wallets table / view
    try {
      const { data: userWalletsView } = await supabaseAdmin
        .from('user_wallets')
        .select('*')
        .eq('user_id', effectiveUserId);

      if (userWalletsView && userWalletsView.length > 0) {
        userWalletsView.forEach(processRow);
      }
    } catch (err) {
      console.warn('user_wallets query error:', err);
    }

    // 5. Fetch from profiles table
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

        if (btc > 0 && balanceMap['BTC'].available === 0) {
          balanceMap['BTC'].available = btc;
          balanceMap['BTC'].total = btc;
        }
        if (eth > 0 && balanceMap['ETH'].available === 0) {
          balanceMap['ETH'].available = eth;
          balanceMap['ETH'].total = eth;
        }
        if (ltc > 0 && balanceMap['LTC'].available === 0) {
          balanceMap['LTC'].available = ltc;
          balanceMap['LTC'].total = ltc;
        }
        if (usdt > 0 && balanceMap['USDT'].available === 0) {
          balanceMap['USDT'].available = usdt;
          balanceMap['USDT'].total = usdt;
        }
      }
    } catch (err) {
      console.warn('profiles query error:', err);
    }

    const formattedList = (Object.keys(balanceMap) as CryptoCurrency[]).map((coin) => ({
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
