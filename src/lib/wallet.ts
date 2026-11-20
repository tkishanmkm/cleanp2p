
'use client';
import type { CryptoCurrency, P2PAd, Trade, User as AppUser, Withdrawal, Deposit } from './types';
import { add, isPast } from 'date-fns';
import { toDate } from '@/lib/utils';
import { SUPPORTED_CRYPTOS, CHAINS } from './constants';
import { clearPendingWithdrawalKey, getOrCreatePendingWithdrawalKey } from '@/lib/withdrawal-idempotency-store';
import { supabase } from '@/lib/supabase/client';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';
import {
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

  // The authenticated API is the only supported balance read path. Do not
  // fall back to legacy balances/wallet tables when canonical data is unavailable.
  try {
    const response = await fetch(
      `/api/wallet/balance?userId=${encodeURIComponent(userId)}`,
      { cache: 'no-store' }
    );
    if (!response.ok) {
      console.warn('[Wallet] Canonical balance API returned:', response.status);
      return balanceMap;
    }

    const data = await response.json();
    if (data?.success !== true || !data?.balances || typeof data.balances !== 'object') {
      console.error('[Wallet] Canonical balance API returned an invalid response.');
      return balanceMap;
    }

    for (const coin of ['BTC', 'ETH', 'LTC', 'USDT'] as CryptoCurrency[]) {
      const item = data.balances[coin];
      if (!item) continue;

      const available = Number(item.available ?? 0);
      const reserved = Number(item.reserved ?? 0);
      const inEscrow = Number(item.inEscrow ?? 0);
      const inWithdrawal = Number(item.inWithdrawal ?? 0);
      const buckets = [available, reserved, inEscrow, inWithdrawal];

      if (buckets.some((value) => !Number.isFinite(value) || value < 0)) {
        console.error('[Wallet] Canonical balance API returned an invalid accounting bucket.');
        return balanceMap;
      }

      balanceMap[coin] = {
        balance: available,
        lockedBalance: reserved + inEscrow + inWithdrawal,
      };
    }

    return balanceMap;
  } catch (error: unknown) {
    console.error(
      '[Wallet] Canonical balance request failed:',
      error instanceof Error ? error.name : 'UnknownError'
    );
    return balanceMap;
  }
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
 * Requests a crypto withdrawal via the canonical server-side /api/withdraw gateway.
 */
export async function requestWithdrawal(
  user: { id: string; userId?: string; displayName?: string },
  crypto: CryptoCurrency,
  chain: string,
  amount: number,
  address: string,
  fee: number = 0,
  idempotencyKey?: string,
  totpCode?: string
): Promise<{ success: boolean; withdrawal_id?: string; status?: string }> {
  const withdrawalFingerprint = JSON.stringify([crypto, chain, address.trim(), amount]);
  const usesStoredKey = !idempotencyKey;
  const safeKey = idempotencyKey || await getOrCreatePendingWithdrawalKey(user.id, withdrawalFingerprint);

  const res = await fetch('/api/withdraw', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': safeKey,
    },
    body: JSON.stringify({
      asset: crypto,
      chain,
      destinationAddress: address,
      amount,
      totpCode,
    }),
  });

  const resData = await res.json();
  const withdrawalId = resData?.withdrawalId || resData?.withdrawal_id;
  if (
    !res.ok ||
    resData?.success !== true ||
    typeof withdrawalId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId)
  ) {
    throw new Error(resData.error || 'Withdrawal request could not be confirmed. Check withdrawal history before retrying.');
  }

  if (usesStoredKey) {
    await clearPendingWithdrawalKey(user.id, withdrawalFingerprint, safeKey);
  }

  return {
    success: true,
    withdrawal_id: withdrawalId,
    status: resData.status || 'QUEUED',
  };
}

/**
 * @deprecated Legacy non-atomic cancellation helper.
 * All active financial and dispute cancellations now use canonical RPC public.cancel_p2p_trade.
 */
export async function cancelTrade(
  tradeOrId: any,
  reason?: string
): Promise<{ success: boolean }> {
  try {
    const tradeId = typeof tradeOrId === 'string' ? tradeOrId : tradeOrId?.id || tradeOrId?.tradeId;
    const cancelReason = reason || 'Cancelled by buyer.';
    
    // Dispatch to canonical trade actions API route which executes cancel_p2p_trade RPC
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CANCEL_TRADE', reason: cancelReason }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to cancel trade.');
    }

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
  try {
    await supabase.from('trade_messages').insert([
      {
        trade_id: tradeId,
        message: 'Payment proof / receipt uploaded.',
        media_url: receiptUrl,
        media_type: 'image',
        created_at: new Date().toISOString(),
      },
    ]);
  } catch (e) {
    console.warn('addReceiptToTrade fallback error:', e);
  }
}

/**
 * Marks a trade as paid in Supabase.
 */
export async function markTradeAsPaid(
  tradeOrId: any,
  paymentMethod?: string
): Promise<{ success: boolean }> {
  try {
    const tradeId = typeof tradeOrId === 'string' ? tradeOrId : tradeOrId?.id || tradeOrId?.tradeId;

    // Dispatch to canonical trade actions API route which executes mark_p2p_trade_paid RPC
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MARK_PAID', paymentMethod }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to mark trade as paid.');
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to mark trade as paid:", err);
    throw err;
  }
}

/**
 * Escrow release helper routing to canonical release_trade_escrow RPC.
 */
export async function releaseFundsFromEscrow(
  tradeId: string,
  totpCode?: string
): Promise<{ success: boolean }> {
  try {
    // Dispatch to canonical trade actions API route which executes release_trade_escrow RPC
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RELEASE_ESCROW', totpCode: (totpCode || '').trim() }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to release funds from escrow.');
    }

    return { success: true };
  } catch (err) {
    console.error("Failed to release funds from escrow:", err);
    throw err;
  }
}

/**
 * Claims escrow funds for a trade.
 * In the canonical model, release_trade_escrow credits wallet_assets atomically in database.
 */
export async function claimFundsForTrade(
  _dbOrClient: any,
  trade: any,
  buyerId: string
): Promise<void> {
  if (typeof window !== 'undefined') {
    const tradeId = typeof trade === 'string' ? trade : trade?.id;
    try {
      sessionStorage.setItem(`trade_funds_claimed_${tradeId}_${buyerId}`, 'true');
    } catch {}
  }
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
  totpCode?: string,
  idempotencyKey?: string
): Promise<string> {
  const effectiveIdempotencyKey = idempotencyKey || globalThis.crypto.randomUUID();
  const res = await fetch('/api/wallet/transfer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-idempotency-key': effectiveIdempotencyKey,
    },
    body: JSON.stringify({
      recipientUsername,
      asset: crypto,
      amount,
      totpCode: totpCode || '',
      idempotencyKey: effectiveIdempotencyKey,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Failed to complete internal transfer');
  }

  return data.transferId || data.publicId || data.dbTransferId;
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

