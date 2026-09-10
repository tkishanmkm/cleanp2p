import { SupabaseClient } from '@supabase/supabase-js';

export interface SystemMessagePayload {
  tradeId: string;
  type:
    | 'TRADE_COMPLETED'
    | 'TRADE_CANCELLED'
    | 'TRADE_EXPIRED'
    | 'TRADE_DISPUTED'
    | 'POSITIVE_FEEDBACK'
    | 'NEGATIVE_FEEDBACK'
    | 'USER_BLOCKED'
    | 'ISSUE_REPORTED'
    | 'MARKED_PAID'
    | 'MESSAGE_BLOCKED'
    | 'SECURITY_REMINDER';
  sellerUsername?: string;
  buyerUsername?: string;
  openerUsername?: string;
  blockedUsername?: string;
  coinAmount?: string | number;
  coinSymbol?: string;
  disputeReason?: string;
  disputeExplanation?: string;
  paymentMethod?: string;
  issueDetails?: string;
  issueCategory?: string;
  feedbackComment?: string;
  customText?: string;
}

export function formatSystemMessageContent(payload: SystemMessagePayload): string {
  const {
    type,
    sellerUsername = 'Seller',
    buyerUsername = 'Buyer',
    openerUsername = 'Trader',
    blockedUsername = 'User',
    coinAmount = '0.00',
    coinSymbol = 'BTC',
    disputeReason = 'Payment issue',
    paymentMethod = '',
    issueDetails = '',
    issueCategory = '',
    feedbackComment = '',
    customText
  } = payload;

  const formattedAmount = typeof coinAmount === 'number' ? coinAmount.toFixed(8) : String(coinAmount);
  const cleanCoin = (coinSymbol || 'BTC').toUpperCase();
  const trimmedComment = (feedbackComment || customText || '').trim().slice(0, 100);

  switch (type) {
    case 'TRADE_COMPLETED':
      return `@${sellerUsername} sold ${formattedAmount} ${cleanCoin} successfully to @${buyerUsername}.\n@${buyerUsername} bought ${formattedAmount} ${cleanCoin} successfully from @${sellerUsername}.`;

    case 'TRADE_CANCELLED':
      return `Trade cancelled. Do not send or pay for this trade. If you have already made a payment, do not cancel or abandon the situation. Open a new trade immediately and contact Paxones Support if assistance is required.`;

    case 'TRADE_EXPIRED':
      return `This trade has expired and is cancelled. Do not make any payment for this trade.`;

    case 'TRADE_DISPUTED': {
      let instructions = '';
      const method = (paymentMethod || '').toLowerCase();
      if (method.includes('bank') || method.includes('wire') || method.includes('sepa') || method.includes('ach')) {
        instructions = `Instructions for Bank Transfer:\n1. Buyer: Upload official bank wire receipt/statement PDF showing sender, beneficiary account, reference code, and debit confirmation.\n2. Seller: Upload bank statement PDF covering trade timeframe showing no credit matching reference.`;
      } else if (method.includes('upi') || method.includes('imps') || method.includes('gpay') || method.includes('phonepe') || method.includes('paytm')) {
        instructions = `Instructions for UPI / IMPS:\n1. Buyer: Submit full screenshot from payment app showing 12-digit UTR/Ref number, recipient UPI ID/account, and timestamp.\n2. Seller: Provide bank account statement or video recording showing transaction timeline without incoming credit.`;
      } else if (method.includes('paypal')) {
        instructions = `Instructions for PayPal:\n1. Buyer: Provide unedited screenshot of PayPal transaction details showing recipient email, transaction ID, and status.\n2. Seller: Provide screenshot of PayPal balance/activity page demonstrating non-receipt or hold.`;
      } else if (method.includes('wise') || method.includes('transferwise')) {
        instructions = `Instructions for Wise:\n1. Buyer: Upload official Wise transfer receipt PDF showing recipient details and 'Sent' status.\n2. Seller: Upload screenshot of Wise multi-currency account activity for trade period.`;
      } else {
        instructions = `Instructions for ${paymentMethod || 'Selected Payment Method'}:\n1. Buyer: Upload proof of payment (statement, receipt, transaction ID, or video confirmation).\n2. Seller: Upload proof of non-receipt (account statement covering trade timeframe).`;
      }

      return `Trade is now in dispute.\nReason: ${disputeReason}\nDispute opened by: @${openerUsername}\n\nPlease provide any requested evidence, documents, payment receipts, screenshots, or other supporting information within the specified timeframe.\n\n${instructions}`;
    }

    case 'POSITIVE_FEEDBACK':
      if (trimmedComment) {
        return `@${openerUsername} left positive feedback "${trimmedComment}"`;
      }
      return `@${openerUsername} left positive feedback.`;

    case 'NEGATIVE_FEEDBACK':
      if (trimmedComment) {
        return `@${openerUsername} left negative feedback "${trimmedComment}"`;
      }
      return `@${openerUsername} left negative feedback.`;

    case 'USER_BLOCKED':
      return `@${openerUsername} blocked @${blockedUsername}.\nImportant: This trade is still active. If you have already made a payment, do not cancel the trade. Keep your payment evidence and follow the trade/dispute instructions.`;

    case 'ISSUE_REPORTED':
      return `@${openerUsername} reported an issue.${issueCategory ? `\nCategory: ${issueCategory}` : ''}\nDetails: ${issueDetails}`;

    case 'MARKED_PAID':
      return `@${buyerUsername} (Buyer) has confirmed payment. @${sellerUsername} (Seller), please check your account and confirm receipt before releasing coin.`;

    case 'MESSAGE_BLOCKED':
      return `Message blocked: For your security, off-platform communication or trading instructions are not permitted in Paxones Trade Chat. Please keep all trade-related communication within Paxones.`;

    case 'SECURITY_REMINDER':
      return `Paxones Security Reminder: Never share your password, 2FA code, private key, seed phrase, or recovery phrase with another user. Paxones Support will not ask you to disclose these credentials.`;

    default:
      return customText || 'Paxones System Notification';
  }
}

/**
 * Inserts an official Paxones System Message into the database
 */
export async function insertPaxonesSystemMessage(
  supabase: SupabaseClient<any, any, any>,
  payload: SystemMessagePayload
): Promise<void> {
  const text = formatSystemMessageContent(payload);
  const now = new Date().toISOString();

  try {
    await supabase.from('trade_messages').insert([
      {
        trade_id: payload.tradeId,
        sender_id: 'system',
        sender_username: 'Paxones System',
        message: text,
        is_moderator: true,
        visibility: 'all',
        created_at: now
      }
    ]);
  } catch (err) {
    console.warn('Error inserting into trade_messages:', err);
  }

  try {
    await supabase.from('trade_chat_messages').insert([
      {
        trade_id: payload.tradeId,
        sender_id: '00000000-0000-0000-0000-000000000000',
        message: text,
        is_system_message: true,
        created_at: now
      }
    ]);
  } catch {
    // Optional fallback
  }
}

/**
 * Restricted keywords and patterns for off-platform communication protection
 */
export const OFF_PLATFORM_KEYWORDS = [
  'whatsapp',
  'what\'s app',
  'whats app',
  'telegram',
  'tele gram',
  'discord',
  'instagram',
  'insta',
  'facebook',
  'signal app',
  'wechat',
  'skype',
  'viber',
  'wickr',
  'snapchat',
  't.me/',
  'wa.me/',
  'chat.whatsapp.com',
  'discord.gg'
];

export const OFF_PLATFORM_PATTERNS = [
  /(?:^|\s)@([a-zA-Z0-9_.]{4,32})/i, // Handle sharing attempt
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, // Phone number pattern
  /\b\d{10,12}\b/, // 10-12 digit sequence (likely phone number)
  /(?:call|text|reach|msg|dm|ping|contact)\s+(?:me|us)?\s*(?:on|at|via)?\s*(?:whatsapp|wa|tg|telegram|insta|ig|discord|phone)/i,
  /(?:my\s+(?:number|whatsapp|telegram|tg|phone|digits)\s+(?:is|:))/i
];

/**
 * Checks if a message contains prohibited off-platform communication keywords or patterns
 */
export function checkOffPlatformMessage(text: string): { isBlocked: boolean; matchedTerm?: string } {
  if (!text) return { isBlocked: false };
  const lower = text.toLowerCase();

  for (const keyword of OFF_PLATFORM_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { isBlocked: true, matchedTerm: keyword };
    }
  }

  for (const pattern of OFF_PLATFORM_PATTERNS) {
    if (pattern.test(text)) {
      return { isBlocked: true, matchedTerm: 'contact pattern' };
    }
  }

  return { isBlocked: false };
}

/**
 * Extract URLs from a message for Phishing Protection
 */
export const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

export function extractUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(URL_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}
