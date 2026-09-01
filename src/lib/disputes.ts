'use client';
import type { Trade, Dispute } from './types';
import { supabase } from '@/lib/supabase/client';

export async function openDispute(
  _db: any,
  trade: Trade,
  openerId: string,
  openerUsername: string,
  reason: string,
  explanation: string
): Promise<void> {
  // 1. Update trade status
  const { error: tradeError } = await supabase
    .from('trades')
    .update({ status: 'disputed' })
    .eq('id', trade.id);

  if (tradeError) {
    console.error('Error updating trade to disputed:', tradeError);
  }

  // 2. Insert dispute record
  const newDispute: Omit<Dispute, 'id' | 'createdAt'> = {
    tradeId: trade.id,
    openedBy: openerId,
    reason: reason,
    explanation: explanation,
    status: 'open',
  };

  await supabase.from('disputes').insert([
    {
      trade_id: trade.id,
      opened_by: openerId,
      reason: reason,
      explanation: explanation,
      status: 'open',
      created_at: new Date().toISOString(),
    },
  ]);

  // 3. Add system message in trade chat
  const systemMessage = {
    trade_id: trade.id,
    sender_id: 'system',
    sender_username: 'System',
    message: `This trade has been marked as disputed. Please do not release any crypto or make any further payment until the moderator reviews the case. Reason from ${openerUsername}: ${reason}\n${explanation}`,
    is_moderator: true,
    created_at: new Date().toISOString(),
  };
  await supabase.from('trade_messages').insert([systemMessage]);

  // 4. Create notifications for both parties
  const opponentId = openerId === trade.buyerId ? trade.sellerId : trade.buyerId;
  const notifications = [
    {
      user_id: openerId,
      message: `You have successfully opened a dispute for trade ${trade.tradeId || trade.id}.`,
      link: `/trade/${trade.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      user_id: opponentId,
      message: `${openerUsername} has opened a dispute on trade ${trade.tradeId || trade.id}. A moderator will join shortly.`,
      link: `/trade/${trade.id}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ];

  await supabase.from('notifications').insert(notifications);
}
