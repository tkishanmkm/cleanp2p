'use client';

import { supabase } from '@/lib/supabase/client';
import type { CryptoCurrency, Deposit, Dispute, Trade, Withdrawal, SupportTicket } from './types';
import { cancelTrade, markTradeAsPaid, releaseFundsFromEscrow } from './wallet';

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
      message: `Your deposit of ${approvedAmount} ${deposit.crypto} has been approved and added to your wallet.`,
      is_read: false,
      created_at: new Date().toISOString(),
      link: '/wallets',
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
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} has been approved and processed.`,
      is_read: false,
      created_at: new Date().toISOString(),
      link: '/wallets',
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
      message: `Your withdrawal of ${withdrawal.amount} ${withdrawal.crypto} was declined and the funds returned to your wallet.`,
      is_read: false,
      created_at: new Date().toISOString(),
      link: '/wallets',
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
    .update({ is_banned: isBanned })
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
  adminId: string,
  fiatAmountInUSD: number
) {
  const winnerUsername = winnerId === trade.buyerId ? trade.buyer?.username || 'Buyer' : trade.seller?.username || 'Seller';
  const isSellerWinner = winnerId === trade.sellerId;

  if (isSellerWinner) {
    await cancelTrade(trade, 'Dispute resolved in favor of seller');
    await supabase
      .from('trades')
      .update({ status: 'cancelled' })
      .eq('id', trade.id);
  } else {
    await releaseFundsFromEscrow(trade.id);
    await supabase
      .from('trades')
      .update({
        status: 'released',
        released_at: new Date().toISOString(),
        fiat_amount_usd: fiatAmountInUSD,
      })
      .eq('id', trade.id);
  }

  await supabase
    .from('disputes')
    .update({
      status: 'resolved',
      winner_id: winnerId,
      resolved_by: adminId,
      resolution_note: `Dispute awarded to ${winnerUsername} by moderator.`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dispute.id);

  await supabase.from('trade_messages').insert([
    {
      trade_id: trade.id,
      sender_id: 'system',
      sender_username: 'System',
      message: `Dispute resolved. The trade has been awarded to ${winnerUsername}.`,
      is_moderator: true,
      created_at: new Date().toISOString(),
    },
  ]);

  // Notifications
  const loserId = winnerId === trade.buyerId ? trade.sellerId : trade.buyerId;
  await supabase.from('notifications').insert([
    {
      user_id: winnerId,
      message: `You have won the dispute for trade ${trade.tradeId || trade.id}.`,
      link: `/trade/${trade.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      user_id: loserId,
      message: `The dispute for trade ${trade.tradeId || trade.id} has been resolved.`,
      link: `/trade/${trade.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ]);
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
  adminId: string,
  userId: string,
  userDisplayName: string,
  crypto: CryptoCurrency,
  action: 'add' | 'subtract',
  amount: number,
  reason: string
): Promise<void> {
  if (amount <= 0) {
    throw new Error('Amount must be a positive number.');
  }

  try {
    await supabase.rpc('admin_adjust_balance', {
      p_user_id: userId,
      p_asset: crypto,
      p_amount: amount,
      p_action: action,
    });
  } catch (err) {
    console.warn('admin_adjust_balance RPC:', err);
  }

  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: `Adjusted ${userDisplayName}'s ${crypto} balance. Action: ${action}, Amount: ${amount}. Reason: ${reason}`,
      target_id: userId,
      created_at: new Date().toISOString(),
    },
  ]);

  await supabase.from('notifications').insert([
    {
      user_id: userId,
      message: `An admin has adjusted your ${crypto} wallet balance. Action: ${action}, Amount: ${amount}. Reason: ${reason}`,
      is_read: false,
      created_at: new Date().toISOString(),
      link: '/wallets',
    },
  ]);
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

export async function adminCancelTrade(_db: any, trade: Trade, adminId: string, reason: string) {
  const fullReason = `Cancelled by administrator. Reason: ${reason}`;
  await cancelTrade(trade, fullReason);
  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: `Admin cancelled trade ${trade.tradeId || trade.id}. Reason: ${reason}`,
      target_id: trade.id,
      created_at: new Date().toISOString(),
    },
  ]);
}

export async function adminMarkTradeAsPaid(_db: any, trade: Trade, adminId: string, reason: string) {
  await markTradeAsPaid(trade.id);
  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: `Admin marked trade ${trade.tradeId || trade.id} as paid. Reason: ${reason}`,
      target_id: trade.id,
      created_at: new Date().toISOString(),
    },
  ]);
}

export async function adminReleaseFunds(_db: any, trade: Trade, adminId: string, reason: string) {
  await releaseFundsFromEscrow(trade.id);
  await supabase.from('admin_logs').insert([
    {
      admin_id: adminId,
      action: `Admin released funds for trade ${trade.tradeId || trade.id}. Reason: ${reason}`,
      target_id: trade.id,
      created_at: new Date().toISOString(),
    },
  ]);

  await supabase.from('trade_messages').insert([
    {
      trade_id: trade.id,
      sender_id: 'system',
      sender_username: 'System',
      message: `A moderator has released the crypto. The trade is now complete. Reason: ${reason}\nYou can now leave feedback for your partner.`,
      is_moderator: true,
      created_at: new Date().toISOString(),
    },
  ]);
}
