import type { Trade, Dispute } from './types';
import { supabase as clientSupabase } from '@/lib/supabase/client';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { insertPaxonesSystemMessage } from '@/lib/trade-system-messages';

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
    return `Instructions for UPI / IMPS:\n1. Buyer: Submit full screenshot from UPI app showing 12-digit UTR/Ref number, recipient UPI ID/account, and time.\n2. Seller: Provide bank account statement or video recording showing transaction timeline without incoming credit.\n3. Both: If upload size is exceeded (>30 MB video / >5 MB doc/image), upload to Google Drive or Dropbox and paste the share link here. Never share passwords or account credentials.`;
  }
  
  if (method.includes('paypal')) {
    return `Instructions for PayPal:\n1. Buyer: Provide unedited screenshot of PayPal transaction details showing recipient email, transaction ID, and status.\n2. Seller: Provide screenshot of PayPal balance/activity page demonstrating transaction hold or non-receipt.\n3. Both: If upload size is exceeded (>30 MB video / >5 MB doc/image), upload to Google Drive or Dropbox and paste the share link here. Never share passwords or account credentials.`;
  }

  if (method.includes('wise') || method.includes('transferwise')) {
    return `Instructions for Wise:\n1. Buyer: Upload official Wise transfer receipt PDF showing recipient details, transfer reference, and 'Sent' status.\n2. Seller: Upload screenshot of Wise multi-currency account activity for the trade period.\n3. Both: If upload size is exceeded (>30 MB video / >5 MB doc/image), upload to Google Drive or Dropbox and paste the share link here. Never share passwords or account credentials.`;
  }

  if (method.includes('bank') || method.includes('wire') || method.includes('sepa') || method.includes('ach')) {
    return `Instructions for Bank Transfer / Wire / SEPA:\n1. Buyer: Upload official bank wire receipt/statement PDF showing sender, beneficiary account, reference code, and debit confirmation.\n2. Seller: Upload bank statement PDF covering from trade start timestamp to present showing no credit matching reference.\n3. Both: If upload size is exceeded (>30 MB video / >5 MB doc/image), upload to Google Drive or Dropbox and paste the share link here. Never share passwords or account credentials.`;
  }

  return `Instructions for ${paymentMethod || 'Selected Payment Method'}:\n1. Buyer: Upload proof of payment (statement, receipt, transaction ID, or video proof of transfer).\n2. Seller: Upload proof of non-receipt (account statement covering the trade timeframe).\n3. Both: If upload size is exceeded (>30 MB video / >5 MB doc/image), upload to Google Drive or Dropbox and paste the share link here. Never share passwords or account credentials.`;
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
  const fullReason = explanation ? `${reason}: ${explanation}` : reason;

  if (!isServer) {
    // 1. Client context: dispatch through secure canonical API route
    const res = await fetch(`/api/trades/${tradeId}/dispute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: fullReason }),
    });

    const resData = await res.json().catch(() => ({}));
    if (!res.ok || resData.error) {
      throw new Error(resData.error || 'Failed to open dispute.');
    }
    return;
  }

  // 2. Server context: execute canonical atomic RPC
  const supabase = await createServerClient();
  const { data: rpcData, error: rpcError } = await supabase.rpc('raise_trade_dispute', {
    p_trade_id: tradeId,
    p_user_id: openerId || null,
    p_reason: fullReason,
  });

  if (rpcError || (rpcData && !rpcData.success)) {
    throw new Error(rpcError?.message || rpcData?.message || 'Failed to raise dispute via canonical RPC.');
  }

  try {
    const { data: tradeData } = await supabase.from('trades').select('buyer_id, seller_id').eq('id', tradeId).maybeSingle();
    const pIds = [tradeData?.buyer_id, tradeData?.seller_id].filter(Boolean);
    for (const pid of pIds) {
      await supabase.from('notifications').insert({
        user_id: pid,
        title: 'Trade Disputed',
        message: `Dispute opened for trade: ${fullReason}`,
        type: 'dispute',
        is_read: false,
        metadata: { link: `/trade/${tradeId}` },
        created_at: new Date().toISOString(),
      });
    }
  } catch (_) {}
}
