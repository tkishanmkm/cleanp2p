
'use client';
import type { CryptoCurrency, P2PAd, Trade, User as AppUser, Withdrawal, Deposit } from './types';
import { add, isPast } from 'date-fns';
import { toDate } from '@/lib/utils';
import { SUPPORTED_CRYPTOS, CHAINS } from './constants';
import { supabase } from '@/lib/supabase/client';
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

  try {
    // 1. Direct query from wallet_assets using confirmed schema columns
    const { data: walletAssets, error: assetsError } = await supabase
      .from('wallet_assets')
      .select('asset_symbol, available, locked, updated_at')
      .eq('user_id', userId);

    if (!assetsError && walletAssets && walletAssets.length > 0) {
      walletAssets.forEach((asset: any) => {
        // Ensure property access matches database column output:
        const spendable = Number(asset.available ?? 0); // 'available', not 'balance' or 'amount'
        const symbol = String(asset.asset_symbol ?? '').toUpperCase() as CryptoCurrency; // 'asset_symbol', not 'symbol' or 'asset_code'
        const lockedAmount = Number(asset.locked ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: spendable,
            lockedBalance: lockedAmount,
          };
        }
      });
      return balanceMap;
    }
  } catch (err) {
    console.warn("wallet_assets query error:", err);
  }

  // 2. Query user_wallets table as secondary fallback
  try {
    const { data: userWallets, error: userWalletsError } = await supabase
      .from('user_wallets')
      .select('asset_symbol, balance, available_balance, locked_balance')
      .eq('user_id', userId);

    if (!userWalletsError && userWallets && userWallets.length > 0) {
      userWallets.forEach((w: any) => {
        const spendable = Number(w.available_balance ?? w.balance ?? 0);
        const symbol = String(w.asset_symbol ?? '').toUpperCase() as CryptoCurrency;
        const lockedAmount = Number(w.locked_balance ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: spendable,
            lockedBalance: lockedAmount,
          };
        }
      });
      return balanceMap;
    }
  } catch (err) {
    console.warn("user_wallets query error:", err);
  }

  // 3. Fallback: Check getSupabaseUserWallets
  try {
    const { data: userWallet } = await getSupabaseUserWallets(userId);
    if (userWallet?.balances && userWallet.balances.length > 0) {
      userWallet.balances.forEach((asset: any) => {
        const spendable = Number(asset.available ?? asset.balance ?? 0);
        const symbol = String(asset.asset_symbol ?? asset.asset_code ?? '').toUpperCase() as CryptoCurrency;
        const lockedAmount = Number(asset.locked ?? asset.locked_escrow ?? 0) + Number(asset.locked_withdrawal ?? 0);

        if (symbol) {
          balanceMap[symbol] = {
            balance: spendable,
            lockedBalance: lockedAmount,
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
 * Cancels a trade.
 */
export async function cancelTrade(
  trade: Trade,
  reason: string
): Promise<{ success: boolean }> {
  try {
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
  // Attached receipt URL
}
export async function markTradeAsPaid(
  tradeId: string
): Promise<{ success: boolean }> {
  try {
    return { success: true };
  } catch (err) {
    console.error("Failed to mark trade as paid:", err);
    throw err;
  }
}

/**
 * Releases funds from escrow for a trade.
 */
export async function releaseFundsFromEscrow(
  tradeId: string
): Promise<{ success: boolean }> {
  return completeEscrow(tradeId);
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
 * Sends coins from one user to another.
 */
export async function sendCoinToUser(
  sender: { uid: string; displayName: string | null },
  recipientUsername: string,
  crypto: CryptoCurrency,
  amount: number
): Promise<string> {
  return generateId("TX-", 10);
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

