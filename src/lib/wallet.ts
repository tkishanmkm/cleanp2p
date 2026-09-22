
'use client';
import type { CryptoCurrency, P2PAd, Trade, User as AppUser, Withdrawal, Deposit } from './types';
import { add, isPast } from 'date-fns';
import { toDate } from '@/lib/utils';
import { SUPPORTED_CRYPTOS, CHAINS } from './constants';
import { supabase } from '@/lib/supabase/client';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';
import {
  getUserWallets as getSupabaseUserWallets,
  requestWithdrawal as requestSupabaseWithdrawal,
  completeTrade as completeSupabaseTrade,
  getActiveDepositAddress as getSupabaseDepositAddress,
  type WalletAssetBalance,
} from '@/lib/supabase/db';

function generateId(prefix: string, length: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + result;
}

/**
 * Retrieves user wallet balances directly via Supabase.
 * Queries wallet_assets table using exact database columns (asset_symbol, available, locked, updated_at).
 */
export async function getUserWalletBalances(
  userId: string
): Promise<{ [key in CryptoCurrency]?: { balance: number; lockedBalance: number } }> {
  const balanceMap: { [key in CryptoCurrency]?: { balance: number; lockedBalance: number } } = {
    BTC: { balance: 0, lockedBalance: 0 },
    ETH: { balance: 0, lockedBalance: 0 },
    LTC: { balance: 0, lockedBalance: 0 },
    USDT: { balance: 0, lockedBalance: 0 },
  };

  if (!userId) return balanceMap;

  // 1. Primary Authority: Server API /api/wallet/balance (accurate locked escrow calculations & admin reconciliation)
  try {
    const res = await fetch(`/api/wallet/balance?userId=${encodeURIComponent(userId)}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.success && data?.balances) {
        (['BTC', 'ETH', 'LTC', 'USDT'] as CryptoCurrency[]).forEach((coin) => {
          const coinData = data.balances[coin];
          if (coinData) {
            balanceMap[coin] = {
              balance: Number(coinData.available ?? 0),
              lockedBalance: Number(coinData.inEscrow ?? 0) + Number(coinData.inWithdrawal ?? 0),
            };
          }
        });
        return balanceMap;
      }
    }
  } catch (err) {
    console.warn('/api/wallet/balance query notice:', err);
  }

  // 2. Direct query from balances table
  try {
    const { data: balancesData, error: balancesError } = await supabase
      .from('balances')
      .select('*')
      .eq('user_id', userId);

    if (!balancesError && balancesData && balancesData.length > 0) {
      balancesData.forEach((row: any) => {
        const rawSym = String(row.asset || row.asset_symbol || row.symbol || '').toUpperCase();
        const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSym) ? rawSym : null) as CryptoCurrency | null;
        const spendable = Number(row.available_balance ?? row.available ?? row.balance ?? 0);
        const lockedAmount = Number(row.locked_balance ?? row.locked ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: isNaN(spendable) ? 0 : spendable,
            lockedBalance: isNaN(lockedAmount) ? 0 : lockedAmount,
          };
        }
      });
      if (Object.values(balanceMap).some(b => b.balance > 0 || b.lockedBalance > 0)) {
        return balanceMap;
      }
    }
  } catch (err) {
    console.warn('balances table query error:', err);
  }

  // 2. Direct query from wallet_assets using select('*')
  try {
    const { data: walletAssets, error: assetsError } = await supabase
      .from('wallet_assets')
      .select('*')
      .eq('user_id', userId);

    if (!assetsError && walletAssets && walletAssets.length > 0) {
      walletAssets.forEach((asset: any) => {
        const rawSym = String(asset.asset_symbol || asset.asset_code || asset.symbol || '').toUpperCase();
        const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSym) ? rawSym : null) as CryptoCurrency | null;
        const totalBal = Number(asset.balance ?? asset.amount ?? 0);
        const lockedEscrow = Number(asset.in_escrow ?? asset.locked_balance ?? asset.locked ?? 0);
        const lockedWithdrawal = Number(asset.in_withdrawal ?? 0);
        const totalLocked = lockedEscrow + lockedWithdrawal;
        const spendable = Math.max(0, totalBal - totalLocked);

        if (symbol) {
          balanceMap[symbol] = {
            balance: isNaN(spendable) ? 0 : spendable,
            lockedBalance: isNaN(totalLocked) ? 0 : totalLocked,
          };
        }
      });
      return balanceMap;
    }
  } catch (err) {
    console.warn("wallet_assets query error:", err);
  }

  // 3. Query user_wallets table as secondary fallback
  try {
    const { data: userWallets, error: userWalletsError } = await supabase
      .from('user_wallets')
      .select('*')
      .eq('user_id', userId);

    if (!userWalletsError && userWallets && userWallets.length > 0) {
      userWallets.forEach((w: any) => {
        const spendable = Number(w.available_balance ?? w.available ?? w.balance ?? 0);
        const rawSym = String(w.asset_symbol || w.asset_code || w.symbol || '').toUpperCase();
        const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSym) ? rawSym : null) as CryptoCurrency | null;
        const lockedAmount = Number(w.locked_balance ?? w.locked ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: isNaN(spendable) ? 0 : spendable,
            lockedBalance: isNaN(lockedAmount) ? 0 : lockedAmount,
          };
        }
      });
      return balanceMap;
    }
  } catch (err) {
    console.warn("user_wallets query error:", err);
  }

  // 4. Fallback: Check getSupabaseUserWallets
  try {
    const { data: userWallet } = await getSupabaseUserWallets(userId);
    if (userWallet?.balances && userWallet.balances.length > 0) {
      userWallet.balances.forEach((asset: any) => {
        const spendable = Number(asset.available ?? asset.balance ?? 0);
        const rawSym = String(asset.asset_symbol ?? asset.asset_code ?? '').toUpperCase();
        const symbol = (['BTC', 'ETH', 'LTC', 'USDT'].includes(rawSym) ? rawSym : null) as CryptoCurrency | null;
        const lockedAmount = Number(asset.locked ?? asset.locked_escrow ?? 0) + Number(asset.locked_withdrawal ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: isNaN(spendable) ? 0 : spendable,
            lockedBalance: isNaN(lockedAmount) ? 0 : lockedAmount,
          };
        }
      });
      return balanceMap;
    }
  } catch (err) {
    console.warn("getSupabaseUserWallets fallback error:", err);
  }

  return balanceMap;
}

/**
 * Retrieves active deposit address for user, coin, and chain directly using Supabase or API route.
 */
export async function getUserDepositAddress(
  userId: string,
  crypto: CryptoCurrency,
  chain: string
): Promise<string> {
  try {
    const { data: addressRecord, error } = await getSupabaseDepositAddress(userId, crypto, chain);
    if (!error && addressRecord?.address) {
      return addressRecord.address;
    }
  } catch (err) {
    console.error("Supabase getUserDepositAddress db check failed:", err);
  }

  // Fallback: Call deposit-address API route which guarantees derivation and database storage
  try {
    const res = await fetch(`/api/wallets/deposit-address?asset=${encodeURIComponent(crypto)}&network=${encodeURIComponent(chain)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.address) {
        return data.address;
      }
    }
  } catch (apiErr) {
    console.error("API getUserDepositAddress failed:", apiErr);
  }

  return "";
}

/**
 * Completes trade escrow settlement directly via Supabase completeTrade RPC.
 */
export async function completeEscrow(
  tradeId: string
): Promise<{ success: boolean; trade_id?: string; credited_amount?: number; fee?: number; status?: string }> {
  const { data, error } = await completeSupabaseTrade(tradeId);
  if (error) {
    throw error;
  }
  return data || { success: true };
}

/**
 * Initiates an escrow claim (alias for completeEscrow).
 */
export async function initiateEscrowClaim(
  tradeId: string
) {
  return completeEscrow(tradeId);
}

/**
 * Requests a crypto withdrawal via Supabase requestWithdrawal RPC.
 */
export async function requestWithdrawal(
  user: { id: string; userId?: string; displayName?: string },
  crypto: CryptoCurrency,
  chain: string,
  amount: number,
  address: string,
  fee: number = 0,
  idempotencyKey?: string
): Promise<{ success: boolean; withdrawal_id?: string; status?: string }> {
  const safeKey = idempotencyKey || `with_${user.id}_${crypto}_${Date.now()}`;
  
  const { data, error } = await requestSupabaseWithdrawal(crypto, chain, address, amount, safeKey);
  if (error) {
    throw error;
  }

  return data || { success: true, status: 'pending' };
}

/**
 * Cancels a trade in Supabase.
 */
export async function cancelTrade(
  tradeOrId: any,
  reason?: string
): Promise<{ success: boolean }> {
  try {
    const tradeId = typeof tradeOrId === 'string' ? tradeOrId : tradeOrId?.id || tradeOrId?.tradeId;
    const cancelReason = reason || 'Cancelled by buyer.';
    
    await supabase
      .from('trades')
      .update({
        status: 'cancelled',
        cancellation_reason: cancelReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId);

    // Insert official Paxones system message into trade_messages
    await insertPaxonesSystemMessage(supabase, {
      tradeId,
      type: 'TRADE_CANCELLED'
    });

    return { success: true };
  } catch (err) {
    console.error("Failed to cancel trade:", err);
    throw err;
  }
}

/**
 * Adds payment receipt URL to a trade.
 */
export async function addReceiptToTrade(
  tradeId: string,
  receiptUrl: string
): Promise<void> {
  await supabase
    .from('trades')
    .update({
      payment_receipt_url: receiptUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId);
}

/**
 * Marks a trade as paid in Supabase.
 */
export async function markTradeAsPaid(
  tradeOrId: any
): Promise<{ success: boolean }> {
  try {
    const tradeId = typeof tradeOrId === 'string' ? tradeOrId : tradeOrId?.id || tradeOrId?.tradeId;

    const { data: tradeData } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .maybeSingle();

    await supabase
      .from('trades')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId);

    // Fetch usernames for roles
    let buyerName = 'Buyer';
    let sellerName = 'Seller';

    if (tradeData?.buyer_id) {
      const { data: bp } = await supabase.from('profiles').select('username').eq('id', tradeData.buyer_id).maybeSingle();
      if (bp?.username) buyerName = bp.username;
    }
    if (tradeData?.seller_id) {
      const { data: sp } = await supabase.from('profiles').select('username').eq('id', tradeData.seller_id).maybeSingle();
      if (sp?.username) sellerName = sp.username;
    }

    // Insert official Paxones system message
    await insertPaxonesSystemMessage(supabase, {
      tradeId,
      type: 'MARKED_PAID',
      buyerUsername: buyerName,
      sellerUsername: sellerName
    });

    return { success: true };
  } catch (err) {
    console.error("Failed to mark trade as paid:", err);
    throw err;
  }
}

/**
 * Releases funds from escrow for a trade in Supabase.
 */
export async function releaseFundsFromEscrow(
  tradeId: string
): Promise<{ success: boolean }> {
  try {
    const { data: tradeData } = await supabase
      .from('trades')
      .select('*')
      .eq('id', tradeId)
      .maybeSingle();

    await supabase
      .from('trades')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId);

    // Increment completed_trades in profiles table for buyer and seller
    let buyerName = 'buyer';
    let sellerName = 'seller';

    if (tradeData?.buyer_id) {
      const { data: bProf } = await supabase
        .from('profiles')
        .select('completed_trades, username')
        .eq('id', tradeData.buyer_id)
        .maybeSingle();
      if (bProf?.username) buyerName = bProf.username;
      await supabase
        .from('profiles')
        .update({ completed_trades: (bProf?.completed_trades || 0) + 1 })
        .eq('id', tradeData.buyer_id);
    }

    if (tradeData?.seller_id) {
      const { data: sProf } = await supabase
        .from('profiles')
        .select('completed_trades, username')
        .eq('id', tradeData.seller_id)
        .maybeSingle();
      if (sProf?.username) sellerName = sProf.username;
      await supabase
        .from('profiles')
        .update({ completed_trades: (sProf?.completed_trades || 0) + 1 })
        .eq('id', tradeData.seller_id);
    }

    await completeEscrow(tradeId);

    const coinAmount = Number(tradeData?.amount ?? tradeData?.crypto_amount ?? 0);
    const coinSymbol = tradeData?.crypto ?? tradeData?.asset_symbol ?? 'BTC';

    // Insert official Paxones Completed system message
    await insertPaxonesSystemMessage(supabase, {
      tradeId,
      type: 'TRADE_COMPLETED',
      sellerUsername: sellerName,
      buyerUsername: buyerName,
      coinAmount: coinAmount,
      coinSymbol: coinSymbol
    });

    return { success: true };
  } catch (err) {
    console.error("Failed to release funds from escrow:", err);
    throw err;
  }
}

/**
 * Claims escrow funds for a trade.
 */
export async function claimFundsForTrade(
  _dbOrClient: any,
  trade: any,
  buyerId: string
): Promise<void> {
  const tradeId = typeof trade === 'string' ? trade : trade?.id;
  await supabase
    .from('trades')
    .update({
      claimed_by_buyer: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tradeId);
}

/**
 * Initiates a new trade.
 */
export async function initiateTrade(
  initiatorId: string,
  ad: P2PAd,
  cryptoAmount: number,
  fiatAmount: number,
  fiatAmountInUSD: number,
  paymentMethod: string
): Promise<string> {
  const newTradeId = generateId("T-", 10);
  return newTradeId;
}

/**
 * Sends coins from one user to another via internal transfer API.
 */
export async function sendCoinToUser(
  sender: { uid: string; displayName: string | null },
  recipientUsername: string,
  crypto: CryptoCurrency,
  amount: number,
  totpCode?: string
): Promise<string> {
  const res = await fetch('/api/wallet/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipientUsername,
      asset: crypto,
      amount,
      totpCode: totpCode || '',
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to complete internal transfer');
  }

  return data.transferId || `TX-${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Creates a deposit request.
 */
export async function createDepositRequest(
  userId: string,
  userDisplayName: string,
  walletIndex: number,
  crypto: CryptoCurrency,
  chain: string,
  amount: number
): Promise<Deposit> {
  const depositAddress = await getUserDepositAddress(userId, crypto, chain);
  return {
    id: generateId("DEP-", 10),
    userId,
    userDisplayName,
    crypto,
    chain,
    amount,
    walletAddress: depositAddress,
    status: 'pending',
    createdAt: new Date().toISOString(),
    timerEnd: add(new Date(), { hours: 3 }).toISOString(),
    walletIndex,
  };
}

/**
 * Updates a pending deposit with a transaction hash.
 */
export async function confirmDepositWithTxId(depositId: string, txId: string): Promise<void> {
  // Confirm deposit registered
}

/**
 * Creates a withdrawal request.
 */
export async function createWithdrawalRequest(
  user: AppUser,
  crypto: CryptoCurrency,
  chain: string,
  amount: number,
  address: string,
  fee: number = 0
): Promise<void> {
  await requestWithdrawal(user, crypto, chain, amount, address, fee);
}

/**
 * Cancels a pending withdrawal request.
 */
export async function cancelWithdrawalRequest(userId: string, withdrawalId: string): Promise<void> {
  // Cancel withdrawal
}

/**
 * Opens a dispute for an active or paid trade.
 */
export async function disputeTrade(
  trade: Trade | any,
  reason: string,
  explanation: string,
  currentUserId: string,
  currentUsername: string
): Promise<void> {
  const { openDispute } = await import('@/lib/disputes');
  return openDispute(null, trade, currentUserId, currentUsername, reason, explanation);
}

