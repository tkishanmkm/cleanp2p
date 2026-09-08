import type { Trade, Dispute } from './types';
import { supabase as clientSupabase } from '@/lib/supabase/client';
import { createClient as createServerClient } from '@/lib/supabase/server';

export interface OpenDisputeParams {
  tradeId: string;
  tradePublicId?: string;
  disputedByUserId: string;
  reason: string;
  paymentMethod?: string;
  explanation?: string;
}

export function getDisputeInstructions(paymentMethod?: string): string {
  const method = (paymentMethod || '').toLowerCase();
  
  if (method.includes('upi') || method.includes('imps') || method.includes('gpay') || method.includes('phonepe') || method.includes('paytm')) {
    return `[DISPUTE PROTOCOL - UPI/IMPS]\n1. Buyer: Submit full screenshot from UPI app showing 12-digit UTR/Ref number, recipient UPI ID/account, and time.\n2. Seller: Provide bank account statement or video recording showing transaction timeline without incoming credit.\n3. Both: If upload size is exceeded, upload media to Google Drive, Dropbox, or OneDrive and paste the public link here.`;
  }
  
  if (method.includes('paypal')) {
    return `[DISPUTE PROTOCOL - PAYPAL]\n1. Buyer: Provide unedited screenshot of PayPal transaction details showing recipient email, transaction ID, and status.\n2. Seller: Provide screenshot of PayPal balance/activity page demonstrating transaction hold or non-receipt.\n3. Both: If upload size is exceeded, upload media to Google Drive, Dropbox, or OneDrive and paste the public link here.`;
  }

  if (method.includes('wise') || method.includes('transferwise')) {
    return `[DISPUTE PROTOCOL - WISE]\n1. Buyer: Upload official Wise transfer receipt PDF showing recipient details, transfer reference, and 'Sent' status.\n2. Seller: Upload screenshot of Wise multi-currency account activity for the trade period.\n3. Both: If upload size is exceeded, upload media to Google Drive, Dropbox, or OneDrive and paste the public link here.`;
  }

  if (method.includes('bank') || method.includes('wire') || method.includes('sepa') || method.includes('ach')) {
    return `[DISPUTE PROTOCOL - BANK TRANSFER / SEPA]\n1. Buyer: Upload official bank wire receipt/statement PDF showing sender, beneficiary account, reference code, and debit confirmation.\n2. Seller: Upload bank statement PDF covering from trade start timestamp to present showing no credit matching reference.\n3. Both: If upload size is exceeded, upload media to Google Drive, Dropbox, or OneDrive and paste the public link here.`;
  }

  return `[DISPUTE PROTOCOL - GENERAL]\n1. Buyer: Upload proof of payment (statement, receipt, transaction ID, or video proof of transfer).\n2. Seller: Upload proof of non-receipt (account statement covering the trade timeframe).\n3. Both: If upload size is exceeded, upload media to Google Drive, Dropbox, or OneDrive and paste the public viewable link here.`;
}

/**
 * Open dispute supporting both object parameters and legacy positional arguments
 */
export async function openDispute(
  arg1: any,
  arg2?: any,
  arg3?: string,
  arg4?: string,
  arg5?: string,
  arg6?: string
): Promise<void> {
  let tradeId: string;
  let tradePublicId: string | undefined;
  let openerId: string;
  let openerUsername: string = 'User';
  let reason: string;
  let explanation: string = '';
  let paymentMethod: string = '';

  if (typeof arg1 === 'object' && !arg2 && 'tradeId' in arg1) {
    // New object format
    const params = arg1 as OpenDisputeParams;
    tradeId = params.tradeId;
    tradePublicId = params.tradePublicId;
    openerId = params.disputedByUserId;
    reason = params.reason;
    explanation = params.explanation || '';
    paymentMethod = params.paymentMethod || '';
  } else {
    // Legacy positional format: (_db, trade, openerId, openerUsername, reason, explanation)
    const trade = arg2 as Trade;
    tradeId = trade?.id || String(arg1);
    tradePublicId = trade?.tradeId || (trade as any)?.public_id;
    openerId = arg3 || '';
    openerUsername = arg4 || 'User';
    reason = arg5 || 'Disputed';
    explanation = arg6 || '';
  }

  // Determine server or client context
  const isServer = typeof window === 'undefined';
  const supabase = isServer ? await createServerClient() : clientSupabase;

  // 1. Update trade status
  await supabase
    .from('trades')
    .update({ status: 'disputed' })
    .eq('id', tradeId);

  // 2. Fetch trade details if missing
  const { data: tradeData } = await supabase
    .from('trades')
    .select('*')
    .eq('id', tradeId)
    .maybeSingle();

  const buyerId = tradeData?.buyer_id;
  const sellerId = tradeData?.seller_id;
  tradePublicId = tradePublicId || (tradeData as any)?.public_id || (tradeData as any)?.publicId || tradeData?.id || tradeId;
  paymentMethod = paymentMethod || tradeData?.payment_method || '';

  // 3. Insert dispute record
  await supabase.from('disputes').insert([
    {
      trade_id: tradeId,
      opened_by: openerId,
      reason: reason,
      explanation: explanation,
      status: 'open',
      created_at: new Date().toISOString(),
    },
  ]);

  // 4. Automated Dispute Assistant System Message in chat
  const instructions = getDisputeInstructions(paymentMethod);
  const botMessage = `⚠️ [PAXONES AUTOMATED DISPUTE ASSISTANT]\nThis trade is now DISPUTED. Escrow is locked.\n\nReason: ${reason}${explanation ? ` - ${explanation}` : ''}\n\n${instructions}\n\nA Paxones Moderator has been alerted and will review all submitted proofs.`;

  await supabase.from('trade_messages').insert([
    {
      trade_id: tradeId,
      sender_id: 'system',
      sender_username: 'Paxones Dispute Assistant',
      message: botMessage,
      is_moderator: true,
      created_at: new Date().toISOString(),
    },
  ]);

  // 5. Notifications
  const opponentId = openerId === buyerId ? sellerId : buyerId;
  const notifications = [
    {
      user_id: openerId,
      message: `You have successfully opened a dispute for trade ${tradePublicId}. Please upload your evidence in the trade chat.`,
      link: `/trade/${tradeId}`,
      is_read: false,
      created_at: new Date().toISOString(),
    },
  ];

  if (opponentId) {
    notifications.push({
      user_id: opponentId,
      message: `Dispute opened on trade ${tradePublicId}. Reason: "${reason}". Please submit counter-evidence in the chat.`,
      link: `/trade/${tradeId}`,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  }

  await supabase.from('notifications').insert(notifications);
}
