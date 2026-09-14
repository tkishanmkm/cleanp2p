import {
  resolvePaymentMethod,
  SystemMessageType as CoreSystemMessageType,
  PaymentCategory as CorePaymentCategory,
  FeedbackType as CoreFeedbackType
} from './trade-system-messages';

export type SystemMessageType = CoreSystemMessageType;
export type PaymentCategory = CorePaymentCategory;
export type FeedbackType = CoreFeedbackType;

export interface AssistantRequest {
  systemMessageType: SystemMessageType;
  buyerUsername?: string;
  sellerUsername?: string;
  initiatorUsername?: string;
  initiatorRole?: 'Buyer' | 'Seller' | 'User';
  targetUsername?: string;
  targetRole?: 'Buyer' | 'Seller' | 'User';
  amount?: number | string;
  asset?: string;
  fiatAmount?: number | string;
  fiatCurrency?: string;
  paymentWindowMins?: number;
  paymentMethodName?: string;
  paymentCategory?: PaymentCategory;
  reason?: string;
  feedbackType?: FeedbackType;
  feedbackComment?: string;
}

export interface AssistantResponse {
  systemMessageType: SystemMessageType;
  metadata: {
    buyerUsername: string;
    sellerUsername: string;
    initiatorUsername: string;
    initiatorRole: string;
    targetUsername: string;
    targetRole: string;
    amount: string | number;
    asset: string;
    fiatAmount: string | number;
    fiatCurrency: string;
    paymentWindowMins: number;
    paymentMethodName: string;
    paymentCategory: PaymentCategory;
    reason: string;
    feedbackType: string;
    feedbackComment: string;
  };
  instructions: {
    buyerAction: string;
    sellerVerification: string;
    specialFocus: string;
    buyerWarnings: string[];
    sellerWarnings: string[];
  };
}

export function generateP2PCompliancePayload(req: AssistantRequest): AssistantResponse {
  const category = req.paymentCategory || 'bank_transfer';
  const methodName = req.paymentMethodName || 'Bank Transfer';

  const profile = resolvePaymentMethod(category, methodName);

  let buyerAction = profile.buyerAction;
  let sellerVerification = profile.sellerVerification;
  let specialFocus = profile.specialFocus;

  // Contextual adjustments based on system message type
  if (req.systemMessageType === 'TRADE_INITIATED') {
    buyerAction = `Review payment details. ${profile.buyerAction} Complete within ${req.paymentWindowMins || 15} minutes.`;
    sellerVerification = `Escrow locked for ${req.amount || '0'} ${req.asset || 'USDT'}. Await buyer payment confirmation.`;
  } else if (req.systemMessageType === 'MARKED_PAID') {
    buyerAction = `Payment marked as sent. Await seller verification and crypto release.`;
    sellerVerification = `Buyer marked trade as paid. CRITICAL: ${profile.sellerVerification} Do not rely on unverified screenshots or email alerts.`;
  } else if (req.systemMessageType === 'TRADE_RELEASED') {
    buyerAction = `Crypto successfully released from escrow to your wallet!`;
    sellerVerification = `Trade completed. Escrow released to buyer.`;
  } else if (req.systemMessageType === 'TRADE_CANCELLED') {
    buyerAction = `Trade cancelled. Locked assets returned to seller.`;
    sellerVerification = `Trade cancelled. Escrow returned to your balance.`;
  } else if (req.systemMessageType === 'TRADE_EXPIRED') {
    buyerAction = `Trade expired due to payment window timeout.`;
    sellerVerification = `Trade expired. Escrow unlocked and returned to seller.`;
  } else if (req.systemMessageType === 'TRADE_DISPUTED') {
    buyerAction = `Dispute opened. Upload official payment receipts, statements, and transaction reference numbers.`;
    sellerVerification = `Dispute opened. Upload official account statement covering trade timeframe showing non-receipt.`;
    specialFocus = `Moderator escalation active. Escrow frozen. Decisions are based on official provider records.`;
  }

  return {
    systemMessageType: req.systemMessageType,
    metadata: {
      buyerUsername: req.buyerUsername || 'buyer_user',
      sellerUsername: req.sellerUsername || 'seller_user',
      initiatorUsername: req.initiatorUsername || 'system_operator',
      initiatorRole: req.initiatorRole || 'User',
      targetUsername: req.targetUsername || 'counterparty_user',
      targetRole: req.targetRole || 'Buyer',
      amount: req.amount || '100.00',
      asset: req.asset || 'USDT',
      fiatAmount: req.fiatAmount || '100.00',
      fiatCurrency: req.fiatCurrency || 'USD',
      paymentWindowMins: req.paymentWindowMins || 15,
      paymentMethodName: profile.name,
      paymentCategory: profile.category,
      reason: req.reason || 'Standard Trade Lifecycle Event',
      feedbackType: req.feedbackType || 'positive',
      feedbackComment: req.feedbackComment || 'Smooth and secure trade experience.'
    },
    instructions: {
      buyerAction,
      sellerVerification,
      specialFocus,
      buyerWarnings: profile.buyerWarnings,
      sellerWarnings: profile.sellerWarnings
    }
  };
}
