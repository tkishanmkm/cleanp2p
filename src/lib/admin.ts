'use client';

import { supabase } from '@/lib/supabase/client';
import type { CryptoCurrency, Deposit, Dispute, Trade, Withdrawal, SupportTicket } from './types';
import { markTradeAsPaid } from './wallet';

/**
 * Approves a deposit and updates the user's wallet.
 */
export async function approveDeposit(
  _db: any,
  deposit: Deposit,
  approvedAmount: number,
  adminId: string
): Promise<void> {
  await supabase
    .from('deposits')
    .update({
      status: 'approved',
      final_amount: approvedAmount,
      admin_id: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deposit.id);

  // Credit user wallet balance via RPC or direct insert/update
  try {
    await supabase.rpc('admin_adjust_balance', {
      p_user_id: deposit.userId,
      p_asset: deposit.crypto,
      p_amount: approvedAmount,
      p_action: 'add',
    });
  } catch (err) {
    console.warn('RPC admin_adjust_balance fallback for deposit approval:', err);
  }

  // Create notification
  await supabase.from('notifications').insert([
    {
      user_id: deposit.userId,
      title: 'Deposit Approved',
      message: `Your deposit of ${approvedAmount} ${deposit.crypto} has been approved and added to your wallet.`,
      type: 'deposit',
      is_read: false,
      created_at: new Date().toISOString(),
      metadata: { link: '/wallets' },
    },
  ]);
}

/**
 * Declines a deposit request.
 */
export async function declineDeposit(
  _db: any,
  deposit: Deposit,
  adminId: string
): Promise<void> {
  await supabase
    .from('deposits')
    .update({
      status: 'declined',
      admin_id: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deposit.id);
}

/**
 * Approves a withdrawal request.
 */
export async function approveWithdrawal(
  _db: any,
  withdrawal: Withdrawal,
  adminId: string
): Promise<void> {
  await supabase
    .from('withdrawals')
    .update({
      status: 'approved',
      admin_id: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawal.id);

  await supabase.from('notifications').insert([
    {
      user_id: withdrawal.userId,
      title: 'Withdrawal Approved',
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} has been approved and processed.`,
      type: 'withdrawal',
      is_read: false,
      created_at: new Date().toISOString(),
      metadata: { link: '/wallets' },
    },
  ]);
}

/**
 * Declines a withdrawal request.
 */
export async function declineWithdrawal(
  _db: any,
  withdrawal: Withdrawal,
  adminId: string
): Promise<void> {
  await supabase
    .from('withdrawals')
    .update({
      status: 'declined',
      admin_id: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', withdrawal.id);

  // Return funds to available balance
  try {
    await supabase.rpc('admin_adjust_balance', {
      p_user_id: withdrawal.userId,
      p_asset: withdrawal.crypto,
      p_amount: withdrawal.amount,
      p_action: 'add',
    });
  } catch (err) {
    console.warn('RPC admin_adjust_balance fallback for withdrawal decline:', err);
  }

  await supabase.from('notifications').insert([
    {
      user_id: withdrawal.userId,
      title: 'Withdrawal Declined',
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} was declined and the funds returned to your wallet.`,
      type: 'withdrawal',
      is_read: false,
      created_at: new Date().toISOString(),
      metadata: { link: '/wallets' },
    },
  ]);
}

export async function setUserBanStatus(
  _db: any,
  userId: string,
  userDisplayName: string,
  isBanned: boolean,
  adminId: string,
  reason: string
) {
  await supabase
    .from('profiles')
    .update({ 
      is_banned: isBanned,
      status_operation_id: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);

  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: isBanned
        ? `Banned user ${userDisplayName}. Reason: ${reason}`
        : `Unbanned user ${userDisplayName}. Reason: ${reason}`,
      target_id: userId,
      created_at: new Date().toISOString(),
    },
  ]);

  await supabase.from('notifications').insert([
    {
      user_id: userId,
      message: isBanned
        ? `Your account has been banned. Reason: ${reason}`
        : `The ban on your account has been lifted. Reason: ${reason}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ]);
}

export async function setUserHoldStatus(
  _db: any,
  userId: string,
  userDisplayName: string,
  isOnHold: boolean,
  adminId: string,
  reason: string
) {
  await supabase
    .from('profiles')
    .update({ is_on_hold: isOnHold })
    .eq('id', userId);

  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: isOnHold
        ? `Placed account of ${userDisplayName} on hold. Reason: ${reason}`
        : `Removed hold on account of ${userDisplayName}. Reason: ${reason}`,
      target_id: userId,
      created_at: new Date().toISOString(),
    },
  ]);

  await supabase.from('notifications').insert([
    {
      user_id: userId,
      message: isOnHold
        ? `Your account has been placed on hold. Reason: ${reason}`
        : `The hold on your account has been removed. Reason: ${reason}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ]);
}

export async function resolveDispute(
  _db: any,
  trade: Trade,
  dispute: Dispute,
  winnerId: string,
  _adminId: string,
  fiatAmountInUSD: number
): Promise<void> {
  // Never settle escrow or mutate dispute/reputation rows from a browser client.
  // The server endpoint is the only supported boundary; it currently fails closed
  // until its atomic settlement + audit RPC has passed PostgreSQL rehearsal.
  if (!trade?.id || !dispute?.id || !winnerId) {
    throw new Error('A valid trade, dispute, and winner are required.');
  }

  const buyerId = String(trade.buyerId || '');
  const sellerId = String(trade.sellerId || '');
  if (winnerId !== buyerId && winnerId !== sellerId) {
    throw new Error('Dispute winner must be a participant in this trade.');
  }
  if (!Number.isFinite(fiatAmountInUSD) || fiatAmountInUSD < 0) {
    throw new Error('Dispute amount is invalid.');
  }

  const winnerUsername = winnerId === buyerId
    ? trade.buyer?.username || 'Buyer'
    : trade.seller?.username || 'Seller';
  const resolutionReason = `Dispute awarded to ${winnerUsername} by moderator.`;

  const response = await fetch('/api/admin/disputes/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      disputeId: dispute.id,
      tradeId: trade.id,
      winnerId,
      reason: resolutionReason,
      amountUsd: fiatAmountInUSD,
    }),
  });
  const result = await response.json().catch(() => null);

  if (
    !response.ok ||
    result?.success !== true ||
    result?.settlementSucceeded !== true ||
    result?.audit_logged !== true
  ) {
    const errorMessage = typeof result?.error === 'string'
      ? result.error
      : 'Dispute settlement was not confirmed by the secure server workflow.';
    throw new Error(errorMessage);
  }
}

export async function updateSupportTicketStatus(
  _db: any,
  ticketId: string,
  status: SupportTicket['status'],
  note?: string
) {
  const updateData: { status: SupportTicket['status']; resolution_note?: string; updated_at: string } = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (note) {
    updateData.resolution_note = note;
  }
  await supabase
    .from('support_tickets')
    .update(updateData)
    .eq('id', ticketId);
}

export async function adjustUserWalletBalance(
  _db: any,
  _adminId: string,
  userId: string,
  _userDisplayName: string,
  crypto: CryptoCurrency,
  action: 'add' | 'subtract',
  amount: number,
  reason: string,
  requestId: string
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0 || Number(amount.toFixed(8)) !== amount) {
    throw new Error('Amount must be positive and have at most 8 decimal places.');
  }
  if (!requestId) {
    throw new Error('An adjustment request ID is required for safe retries.');
  }

  // Never call an administrator financial RPC from the browser client. The
  // server derives the actor from its verified administrator session.
  const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      asset: crypto,
      action,
      amount,
      reason,
      requestId,
    }),
  });
  const result = await response.json().catch(() => null);

  if (
    !response.ok ||
    result?.success !== true ||
    result?.audit_logged !== true ||
    result?.data?.success !== true
  ) {
    const errorMessage = typeof result?.error === 'string'
      ? result.error
      : 'The server did not confirm both the balance adjustment and its audit record.';
    throw new Error(errorMessage);
  }
}

export async function adminUnblockUser(
  _db: any,
  ownerUserId: string,
  targetUserIdToUnblock: string
): Promise<void> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('blocked_users')
    .eq('id', ownerUserId)
    .single();

  const blocked: string[] = profile?.blocked_users || [];
  await supabase
    .from('profiles')
    .update({ blocked_users: blocked.filter((id) => id !== targetUserIdToUnblock) })
    .eq('id', ownerUserId);
}

export async function adminCancelTrade(_db: any, trade: Trade, _adminId: string, reason: string) {
  // Cancellation refunds escrow, so route it through server-side administrator
  // authorization instead of calling a restricted financial RPC from the browser.
  const response = await fetch(`/api/admin/trades/${encodeURIComponent(trade.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'intervene',
      interveneAction: 'refund',
      reason
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    const errorMsg = typeof result?.error === 'string'
      ? result.error
      : 'Admin trade cancellation was rejected. Verify the trade state and your permissions.';
    console.error('adminCancelTrade request failed:', response.status);
    throw new Error(errorMsg);
  }
}

export async function adminMarkTradeAsPaid(_db: any, trade: Trade, _adminId: string, reason: string) {
  // Admin payment confirmation must pass the server's admin + signed 2FA gate.
  // The actor ID/email are derived by that route and never accepted from the browser.
  const response = await fetch(`/api/admin/trades/${encodeURIComponent(trade.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'mark_paid',
      reason,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    const errorMsg = typeof result?.error === 'string'
      ? result.error
      : 'Administrative payment confirmation was rejected. Verify the trade state and your permissions.';
    console.error('adminMarkTradeAsPaid request failed:', response.status);
    throw new Error(errorMsg);
  }
}
export async function adminReleaseFunds(_db: any, trade: Trade, _adminId: string, reason: string) {
  // Escrow release is service-role-only in production. Use the server endpoint
  // so admin identity is verified server-side; do not expose the financial RPC
  // to authenticated browser clients.
  const response = await fetch(`/api/admin/trades/${encodeURIComponent(trade.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'intervene',
      interveneAction: 'release',
      reason
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    const errorMsg = typeof result?.error === 'string'
      ? result.error
      : 'Admin escrow release was rejected. Verify the trade state and your permissions.';
    console.error('adminReleaseFunds request failed:', response.status);
    throw new Error(errorMsg);
  }
}
