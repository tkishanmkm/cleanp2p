import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';

export type SystemMessageType =
  | 'TRADE_INITIATED'
  | 'MARKED_PAID'
  | 'TRADE_RELEASED'
  | 'TRADE_CANCELLED'
  | 'TRADE_EXPIRED'
  | 'TRADE_DISPUTED'
  | 'TRADE_REPORTED'
  | 'USER_BLOCKED'
  | 'FEEDBACK_LEFT';

export type PaymentCategory =
  | 'bank_transfer'
  | 'online_wallet'
  | 'mobile_money'
  | 'cash_payments'
  | 'gift_cards'
  | 'custom';

export type FeedbackType = 'positive' | 'negative';

export interface MessageMetadata {
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
  paymentCategory?: PaymentCategory | string;
  reason?: string;
  feedbackType?: FeedbackType;
  feedbackComment?: string;
}

export interface PaymentMethodProfile {
  name: string;
  category: PaymentCategory;
  buyerAction: string;
  sellerVerification: string;
  specialFocus: string;
  buyerWarnings: string[];
  sellerWarnings: string[];
}

const BASE_WARNINGS = {
  buyer: [
    'Use only the official app/site of the payment provider.',
    'Confirm the recipient name/identifier and exact amount before final approval.',
    'Never share passwords, OTPs, PINs, recovery phrases, private keys, or full authentication codes in trade chat.',
    'Keep the official receipt/reference number for the entire dispute window.'
  ],
  seller: [
    'Verify payment directly inside the official provider account or bank ledger.',
    'Do not rely on screenshots, emails, SMS alerts, forwarded receipts, or edited media as final proof.',
    'Confirm the funds are completed/cleared and actually available before releasing crypto.',
    'Never ask the buyer for passwords, OTPs, PINs, recovery phrases, or private keys.'
  ]
} as const;

export const PAYMENT_METHODS: Record<string, PaymentMethodProfile> = {
  "Bank Transfer": {
    name: "Bank Transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Bank Transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Bank Transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "SEPA Transfer": {
    name: "SEPA Transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using SEPA Transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official SEPA Transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the beneficiary IBAN and recipient name; keep the SEPA transfer reference and confirm cleared funds.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "SWIFT": {
    name: "SWIFT",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using SWIFT. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official SWIFT account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Confirm beneficiary banking coordinates and any applicable intermediary/fee details; retain the SWIFT/bank reference and final credit confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "UPI (Unified Payments Interface)": {
    name: "UPI (Unified Payments Interface)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using UPI (Unified Payments Interface). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official UPI (Unified Payments Interface) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use the seller's exact UPI ID/QR details shown in the trade. Verify the recipient name on the confirmation screen before sending.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "IMPS (Immediate Payment Service)": {
    name: "IMPS (Immediate Payment Service)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using IMPS (Immediate Payment Service). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official IMPS (Immediate Payment Service) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the beneficiary account/IFSC and beneficiary name before confirming the IMPS transfer.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "NEFT (National Electronic Funds Transfer)": {
    name: "NEFT (National Electronic Funds Transfer)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using NEFT (National Electronic Funds Transfer). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official NEFT (National Electronic Funds Transfer) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "RTGS (Real-Time Gross Settlement)": {
    name: "RTGS (Real-Time Gross Settlement)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using RTGS (Real-Time Gross Settlement). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official RTGS (Real-Time Gross Settlement) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the beneficiary details and retain the bank-generated UTR; treat only cleared account balance as final proof.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Interac e-Transfer": {
    name: "Interac e-Transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Interac e-Transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Interac e-Transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient email/phone and security details shown in the transfer flow; seller must confirm deposit in the bank account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PayID": {
    name: "PayID",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using PayID. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PayID account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the PayID resolves to the intended recipient before submitting the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Osko": {
    name: "Osko",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Osko. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Osko account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the PayID/account details and recipient name displayed by the bank before sending.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Pix (Brazil)": {
    name: "Pix (Brazil)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Pix (Brazil). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Pix (Brazil) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the Pix key or QR recipient name before confirming payment; keep the Pix end-to-end ID/receipt.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "SPEI (Mexico)": {
    name: "SPEI (Mexico)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using SPEI (Mexico). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official SPEI (Mexico) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify CLABE/account beneficiary details and retain the SPEI tracking key/reference.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "CoDi (Mexico)": {
    name: "CoDi (Mexico)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using CoDi (Mexico). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official CoDi (Mexico) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PSE (Colombia)": {
    name: "PSE (Colombia)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using PSE (Colombia). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PSE (Colombia) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete payment in the official PSE flow and retain the bank/payment confirmation reference.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Transfiya (Colombia)": {
    name: "Transfiya (Colombia)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Transfiya (Colombia). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Transfiya (Colombia) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "FPS (Faster Payment System)": {
    name: "FPS (Faster Payment System)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using FPS (Faster Payment System). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official FPS (Faster Payment System) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Domestic wire transfer": {
    name: "Domestic wire transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Domestic wire transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Domestic wire transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "International wire transfer": {
    name: "International wire transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using International wire transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official International wire transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "ACH transfer": {
    name: "ACH transfer",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using ACH transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official ACH transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify routing and account details and wait for the seller to confirm the funds are actually available, not merely initiated.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "EFT (Electronic Funds Transfer)": {
    name: "EFT (Electronic Funds Transfer)",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using EFT (Electronic Funds Transfer). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official EFT (Electronic Funds Transfer) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Direct debit": {
    name: "Direct debit",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Direct debit. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Direct debit account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Only use a direct-debit method when the trade explicitly supports it and the debit has actually settled; a mandate alone is not payment proof.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "iDEAL": {
    name: "iDEAL",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using iDEAL. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official iDEAL account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete the payment through the official bank authorization page and retain the successful payment reference.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Bancontact": {
    name: "Bancontact",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Bancontact. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Bancontact account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete payment through the official Bancontact flow and retain the transaction confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Giropay": {
    name: "Giropay",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Giropay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Giropay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete the bank authorization in the official flow and retain the successful payment confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "EPS": {
    name: "EPS",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using EPS. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official EPS account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete payment through the official EPS bank flow and retain the bank confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Sofort": {
    name: "Sofort",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Sofort. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Sofort account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Complete the official bank-redirect flow and retain the successful transaction confirmation; seller verifies settled funds.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PesaLink": {
    name: "PesaLink",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using PesaLink. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PesaLink account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "BLIK": {
    name: "BLIK",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using BLIK. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official BLIK account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient/payment context before entering the BLIK code and retain the successful payment confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Przelewy24": {
    name: "Przelewy24",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Przelewy24. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Przelewy24 account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use the official payment page, verify merchant/payment details, and retain the confirmation/reference.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "MB WAY": {
    name: "MB WAY",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using MB WAY. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official MB WAY account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the intended recipient and payment request inside the official app before approving.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Bizum": {
    name: "Bizum",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Bizum. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Bizum account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient phone/name shown in the official banking app before sending.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Swish": {
    name: "Swish",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Swish. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Swish account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient name/number shown by Swish and retain the payment confirmation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "TWINT": {
    name: "TWINT",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using TWINT. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official TWINT account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient and amount in the official TWINT confirmation screen before approving.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Paylib": {
    name: "Paylib",
    category: "bank_transfer",
    buyerAction: "Pay exactly the agreed amount using Paylib. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Paylib account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient identity/details in the supported bank flow before confirming.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Wise (formerly TransferWise)": {
    name: "Wise (formerly TransferWise)",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Wise (formerly TransferWise). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Wise (formerly TransferWise) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient details and any displayed fee/exchange information; seller releases only after the Wise balance shows completed funds.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Revolut": {
    name: "Revolut",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Revolut. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Revolut account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient profile and account details inside the official Revolut app; seller checks the transaction as completed and settled.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PayPal": {
    name: "PayPal",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using PayPal. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PayPal account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use the exact verified PayPal recipient shown in the trade and seller verifies the transaction in the PayPal account, including payment status and any holds.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Skrill": {
    name: "Skrill",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Skrill. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Skrill account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient account identifier and seller verifies the incoming payment as completed in Skrill.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Neteller": {
    name: "Neteller",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Neteller. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Neteller account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient account identifier and seller verifies the incoming payment as completed in Neteller.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Payoneer": {
    name: "Payoneer",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Payoneer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Payoneer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the receiving account details and seller confirms funds are available in the official Payoneer balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Zelle": {
    name: "Zelle",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Zelle. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Zelle account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient name before sending; seller verifies the deposit inside the bank/Zelle-linked account. Do not rely on screenshots or emails.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Venmo": {
    name: "Venmo",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Venmo. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Venmo account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient profile and seller verifies the transaction inside Venmo, including completed status and available balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Cash App": {
    name: "Cash App",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Cash App. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Cash App account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient $cashtag/profile and seller verifies the payment inside Cash App, not by SMS/email.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Google Pay": {
    name: "Google Pay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Google Pay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Google Pay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient and amount in the official Google Pay/payment flow; seller verifies settlement in the linked financial account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Apple Pay": {
    name: "Apple Pay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Apple Pay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Apple Pay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use only the platform-supported Apple Pay payment flow; seller verifies actual settlement in the receiving account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Alipay": {
    name: "Alipay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Alipay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Alipay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient account/QR and seller verifies completed funds inside the official Alipay account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "WeChat Pay": {
    name: "WeChat Pay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using WeChat Pay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official WeChat Pay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient/payment details and seller confirms the completed transaction inside the official WeChat Pay wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Mercado Pago": {
    name: "Mercado Pago",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Mercado Pago. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Mercado Pago account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient identity and amount in Mercado Pago; seller verifies completed, available balance inside the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PicPay": {
    name: "PicPay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using PicPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PicPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient details and seller confirms completed funds in the official PicPay account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "AstroPay": {
    name: "AstroPay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using AstroPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official AstroPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Advcash": {
    name: "Advcash",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Advcash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Advcash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Perfect Money": {
    name: "Perfect Money",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Perfect Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Perfect Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Payeer": {
    name: "Payeer",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Payeer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Payeer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "AirTM": {
    name: "AirTM",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using AirTM. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official AirTM account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Uphold": {
    name: "Uphold",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Uphold. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Uphold account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Paybis": {
    name: "Paybis",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Paybis. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Paybis account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "QIWI": {
    name: "QIWI",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using QIWI. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official QIWI account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "YooMoney (formerly Yandex.Money)": {
    name: "YooMoney (formerly Yandex.Money)",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using YooMoney (formerly Yandex.Money). Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official YooMoney (formerly Yandex.Money) account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "WebMoney": {
    name: "WebMoney",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using WebMoney. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official WebMoney account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PayU": {
    name: "PayU",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using PayU. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PayU account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Verse": {
    name: "Verse",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Verse. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Verse account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Lydia": {
    name: "Lydia",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Lydia. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Lydia account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PostePay": {
    name: "PostePay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using PostePay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PostePay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "SATISPAY": {
    name: "SATISPAY",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using SATISPAY. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official SATISPAY account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Trustly": {
    name: "Trustly",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Trustly. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Trustly account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Klarna": {
    name: "Klarna",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Klarna. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Klarna account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Stripe": {
    name: "Stripe",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Stripe. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Stripe account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use only an approved Stripe payment flow for the trade; seller verifies the payment status in Stripe rather than relying on a client-side success screen.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Binance Pay": {
    name: "Binance Pay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Binance Pay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Binance Pay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient ID/QR and exact amount in Binance Pay; seller confirms the payment as completed in the official account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Crypto.com Pay": {
    name: "Crypto.com Pay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Crypto.com Pay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Crypto.com Pay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the payment request/QR and exact amount; seller verifies settled payment inside the official merchant/account view.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Coinbase Commerce": {
    name: "Coinbase Commerce",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Coinbase Commerce. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Coinbase Commerce account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use only the exact Coinbase Commerce payment request linked to the trade; seller verifies the transaction as paid/confirmed in the merchant dashboard.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "BitPay": {
    name: "BitPay",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using BitPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official BitPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Use the exact BitPay invoice/payment request and seller verifies the invoice status in the official BitPay merchant/account interface.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Paxful": {
    name: "Paxful",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Paxful. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Paxful account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Only use Paxful as a permitted external payment rail if your platform's rules allow it; verify settlement in the receiving Paxful account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Remitly": {
    name: "Remitly",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Remitly. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Remitly account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Retain the transfer/reference number and require the receiving side to verify actual receipt/availability, not just transfer initiation.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "WorldRemit": {
    name: "WorldRemit",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using WorldRemit. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official WorldRemit account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Retain the transfer/reference number and require the receiving side to verify actual receipt/availability.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Xoom": {
    name: "Xoom",
    category: "online_wallet",
    buyerAction: "Pay exactly the agreed amount using Xoom. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Xoom account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Retain the Xoom transaction/reference number and require the receiving side to verify actual receipt/availability.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "M-Pesa": {
    name: "M-Pesa",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using M-Pesa. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official M-Pesa account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient number/name and seller confirms the incoming transaction inside the official M-Pesa account/statement.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Airtel Money": {
    name: "Airtel Money",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Airtel Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Airtel Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient number/name and seller confirms the incoming transaction inside the official Airtel Money account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "MTN Mobile Money": {
    name: "MTN Mobile Money",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using MTN Mobile Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official MTN Mobile Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient number/name and seller confirms the incoming transaction inside the official MTN MoMo wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Orange Money": {
    name: "Orange Money",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Orange Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Orange Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient number/name and seller confirms the incoming transaction inside the official Orange Money wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Vodafone Cash": {
    name: "Vodafone Cash",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Vodafone Cash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Vodafone Cash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient number/name and seller confirms the incoming transaction inside the official Vodafone Cash wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Tigo Money": {
    name: "Tigo Money",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Tigo Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Tigo Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient number/name and seller confirms the incoming transaction inside the official Tigo wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "MoMo": {
    name: "MoMo",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using MoMo. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official MoMo account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient shown by the official MoMo flow and seller confirms actual wallet credit.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "ZaloPay": {
    name: "ZaloPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using ZaloPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official ZaloPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "ViettelPay": {
    name: "ViettelPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using ViettelPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official ViettelPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Paytm": {
    name: "Paytm",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Paytm. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Paytm account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient name/UPI details and seller confirms the incoming transaction in the official Paytm account.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PhonePe": {
    name: "PhonePe",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using PhonePe. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PhonePe account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the recipient name/UPI details and seller confirms the incoming payment in PhonePe/bank statement.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "GCash": {
    name: "GCash",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using GCash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official GCash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient details and seller confirms the incoming GCash balance/transaction history.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PayMaya": {
    name: "PayMaya",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using PayMaya. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PayMaya account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient details and seller confirms the incoming balance/transaction history in the official wallet.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "GrabPay": {
    name: "GrabPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using GrabPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official GrabPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming GrabPay balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "GoPay": {
    name: "GoPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using GoPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official GoPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming GoPay balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "OVO": {
    name: "OVO",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using OVO. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official OVO account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming OVO balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "DANA": {
    name: "DANA",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using DANA. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official DANA account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming DANA balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "LinkAja": {
    name: "LinkAja",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using LinkAja. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official LinkAja account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming LinkAja balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Touch 'n Go eWallet": {
    name: "Touch 'n Go eWallet",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Touch 'n Go eWallet. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Touch 'n Go eWallet account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming eWallet balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Boost": {
    name: "Boost",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Boost. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Boost account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms the incoming Boost wallet balance.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Easypaisa": {
    name: "Easypaisa",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Easypaisa. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Easypaisa account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "JazzCash": {
    name: "JazzCash",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using JazzCash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official JazzCash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "bKash": {
    name: "bKash",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using bKash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official bKash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Nagad": {
    name: "Nagad",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Nagad. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Nagad account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Rocket": {
    name: "Rocket",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Rocket. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Rocket account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Khalti": {
    name: "Khalti",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Khalti. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Khalti account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "eSewa": {
    name: "eSewa",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using eSewa. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official eSewa account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Wave Money": {
    name: "Wave Money",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Wave Money. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Wave Money account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "KBZPay": {
    name: "KBZPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using KBZPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official KBZPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Tigo Pesa": {
    name: "Tigo Pesa",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Tigo Pesa. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Tigo Pesa account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Halopesa": {
    name: "Halopesa",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Halopesa. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Halopesa account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/mobile account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Azampay": {
    name: "Azampay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Azampay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Azampay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Chipper Cash": {
    name: "Chipper Cash",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using Chipper Cash. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Chipper Cash account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "JumiaPay": {
    name: "JumiaPay",
    category: "mobile_money",
    buyerAction: "Pay exactly the agreed amount using JumiaPay. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official JumiaPay account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify recipient/account details and seller confirms actual wallet credit in the official app.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Cash deposit to bank": {
    name: "Cash deposit to bank",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Cash deposit to bank. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Cash deposit to bank account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Cash in person": {
    name: "Cash in person",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Cash in person. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Cash in person account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Western Union": {
    name: "Western Union",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Western Union. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Western Union account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "MoneyGram": {
    name: "MoneyGram",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using MoneyGram. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official MoneyGram account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Ria Money Transfer": {
    name: "Ria Money Transfer",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Ria Money Transfer. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Ria Money Transfer account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Cash by mail": {
    name: "Cash by mail",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Cash by mail. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Cash by mail account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Postal order": {
    name: "Postal order",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Postal order. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Postal order account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Bank draft": {
    name: "Bank draft",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Bank draft. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Bank draft account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Cashier's check": {
    name: "Cashier's check",
    category: "cash_payments",
    buyerAction: "Pay exactly the agreed amount using Cashier's check. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Cashier's check account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Amazon Gift Card": {
    name: "Amazon Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Amazon Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Amazon Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "iTunes Gift Card": {
    name: "iTunes Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using iTunes Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official iTunes Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Google Play Gift Card": {
    name: "Google Play Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Google Play Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Google Play Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Steam Gift Card": {
    name: "Steam Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Steam Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Steam Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "PlayStation Network Gift Card": {
    name: "PlayStation Network Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using PlayStation Network Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official PlayStation Network Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Xbox Gift Card": {
    name: "Xbox Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Xbox Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Xbox Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Nintendo eShop Gift Card": {
    name: "Nintendo eShop Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Nintendo eShop Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Nintendo eShop Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "eBay Gift Card": {
    name: "eBay Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using eBay Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official eBay Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Walmart Gift Card": {
    name: "Walmart Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Walmart Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Walmart Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Target Gift Card": {
    name: "Target Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Target Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Target Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Best Buy Gift Card": {
    name: "Best Buy Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Best Buy Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Best Buy Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Sephora Gift Card": {
    name: "Sephora Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Sephora Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Sephora Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Starbucks Gift Card": {
    name: "Starbucks Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Starbucks Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Starbucks Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Netflix Gift Card": {
    name: "Netflix Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Netflix Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Netflix Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Spotify Gift Card": {
    name: "Spotify Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Spotify Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Spotify Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Uber Gift Card": {
    name: "Uber Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Uber Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Uber Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Lyft Gift Card": {
    name: "Lyft Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Lyft Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Lyft Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Airbnb Gift Card": {
    name: "Airbnb Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Airbnb Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Airbnb Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Hotels.com Gift Card": {
    name: "Hotels.com Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Hotels.com Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Hotels.com Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Delta Air Lines Gift Card": {
    name: "Delta Air Lines Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Delta Air Lines Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Delta Air Lines Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Southwest Airlines Gift Card": {
    name: "Southwest Airlines Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Southwest Airlines Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Southwest Airlines Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "American Airlines Gift Card": {
    name: "American Airlines Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using American Airlines Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official American Airlines Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Vanilla Visa/Mastercard Gift Card": {
    name: "Vanilla Visa/Mastercard Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Vanilla Visa/Mastercard Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Vanilla Visa/Mastercard Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Razer Gold Gift Card": {
    name: "Razer Gold Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Razer Gold Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Razer Gold Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Roblox Gift Card": {
    name: "Roblox Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Roblox Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Roblox Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Fortnite V-Bucks Gift Card": {
    name: "Fortnite V-Bucks Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Fortnite V-Bucks Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Fortnite V-Bucks Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Apple Gift Card": {
    name: "Apple Gift Card",
    category: "gift_cards",
    buyerAction: "Pay exactly the agreed amount using Apple Gift Card. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Apple Gift Card account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
  "Custom Payment Method": {
    name: "Custom Payment Method",
    category: "custom",
    buyerAction: "Pay exactly the agreed amount using Custom Payment Method. Follow the provider's official confirmation flow, verify the recipient identity/details before authorizing, and retain the provider reference/receipt.",
    sellerVerification: "Open the official Custom Payment Method account or supported receiving channel and verify the transaction is completed, the exact amount is received, and the funds are available. Release only after direct verification.",
    specialFocus: "Verify the exact recipient, amount, and transaction status shown by the official provider before completing the payment.",
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  },
};

function normalizeMethodName(value: string): string {
  return (value || '').trim().toLowerCase();
}

export function resolvePaymentMethod(
  category: PaymentCategory | string = 'bank_transfer',
  methodName: string = 'Payment Method'
): PaymentMethodProfile {
  const exact = PAYMENT_METHODS[methodName];
  if (exact) return exact;

  const wanted = normalizeMethodName(methodName);
  const found = Object.values(PAYMENT_METHODS).find(
    (p) => normalizeMethodName(p.name) === wanted
  );
  if (found) return found;

  return {
    name: methodName || 'Custom Payment Method',
    category: category as PaymentCategory,
    buyerAction:
      `Use the provider's official payment flow for ${methodName || 'the custom method'}. ` +
      `Verify recipient, exact amount, status, and transaction reference before marking paid.`,
    sellerVerification:
      `Verify the custom payment directly in the official receiving account/system. ` +
      `Release only after the exact amount is confirmed as completed and available.`,
    specialFocus:
      'Custom methods must have an explicit provider, recipient format, settlement state, and dispute-proof requirement configured by the platform.',
    buyerWarnings: [...BASE_WARNINGS.buyer],
    sellerWarnings: [...BASE_WARNINGS.seller]
  };
}

export function getCategorySpecificInstructions(
  category: PaymentCategory | string = 'bank_transfer',
  methodName: string = 'Payment Method',
  fiatAmount: string,
  fiatCurrency: string
): { buyerSteps: string[]; sellerSteps: string[] } {
  const profile = resolvePaymentMethod(category, methodName);

  const giftCard = profile.category === 'gift_cards';
  const cash = profile.category === 'cash_payments';

  const buyerSteps = [
    `1. ${profile.buyerAction}`,
    `2. ${profile.specialFocus}`,
    `3. Pay exactly ${fiatAmount} ${fiatCurrency}; do not send a different amount unless the trade is changed and re-confirmed.`,
    `4. Save the official receipt/reference and upload only the minimum evidence required by the trade.`,
    `5. After the provider confirms submission, tap "Mark as Paid" and keep all communication inside the trade chat.`,
    ...profile.buyerWarnings.map((x) => `⚠️ ${x}`),
  ];

  const sellerSteps = [
    `1. ${profile.sellerVerification}`,
    `2. Confirm the received amount is exactly ${fiatAmount} ${fiatCurrency}.`,
    `3. ${profile.specialFocus}`,
    `4. Check the official transaction/ledger status, sender/recipient details, and reference where available.`,
    `5. Release ${cash ? 'only after physical/official confirmation of cleared funds' : giftCard ? 'only after the balance/code is independently verified as valid and unused where applicable' : 'crypto only after the funds are confirmed as completed and available'}.`,
    ...profile.sellerWarnings.map((x) => `⚠️ ${x}`),
  ];

  return {
    buyerSteps: buyerSteps.slice(0, 10),
    sellerSteps: sellerSteps.slice(0, 10)
  };
}

function feedbackBadge(type?: FeedbackType): string {
  return type === 'positive' ? '👍 POSITIVE' : '👎 NEGATIVE';
}

function feedbackGuidance(type?: FeedbackType): string[] {
  if (type === 'positive') {
    return [
      'Completed the trade as agreed.',
      'Payment was verified without avoidable delay.',
      'Communication and trade behavior were reliable.'
    ];
  }
  return [
    'Payment or release did not follow the agreed trade terms.',
    'Required verification or communication was not completed correctly.',
    'Use the trade dispute process when money or escrow is still at risk.'
  ];
}

export async function sendTradeSystemMessage(
  tradeId: string,
  type: SystemMessageType,
  metadata: MessageMetadata
) {
  const supabase = createClient();
  let messageText = '';

  const asset = (metadata.asset || 'USDT').toUpperCase();
  const fiatCurrency = (metadata.fiatCurrency || 'INR').toUpperCase();
  const amount = metadata.amount ? Number(metadata.amount).toFixed(2) : '0.00';
  const fiatAmount = metadata.fiatAmount ? Number(metadata.fiatAmount).toFixed(2) : '0.00';
  const windowMins = metadata.paymentWindowMins || 30;
  const methodName = metadata.paymentMethodName || 'Payment Method';
  const category = metadata.paymentCategory || 'bank_transfer';

  const { buyerSteps, sellerSteps } = getCategorySpecificInstructions(
    category,
    methodName,
    fiatAmount,
    fiatCurrency
  );

  switch (type) {
    case 'TRADE_INITIATED':
      messageText =
        `🔒 TRADE INITIATED & ESCROW LOCKED\n` +
        `----------------------------------------\n` +
        `• Buyer: @${metadata.buyerUsername}\n` +
        `• Seller: @${metadata.sellerUsername}\n` +
        `• Amount: ${amount} ${asset} for ${fiatAmount} ${fiatCurrency}\n` +
        `• Selected Payment Rail: ${methodName}\n` +
        `• Payment Window: ${windowMins} Minutes\n` +
        `----------------------------------------\n` +
        `📥 BUYER INSTRUCTIONS (@${metadata.buyerUsername}):\n` +
        `${buyerSteps.join('\n')}\n\n` +
        `⚠️ SELLER INSTRUCTIONS (@${metadata.sellerUsername}):\n` +
        `• The crypto funds (${amount} ${asset} + escrow fee) are securely locked in Paxones Escrow.\n` +
        `• Do NOT transfer crypto outside of this platform. Wait for the buyer to mark as paid and verify the receiving account directly.`;
      break;

    case 'MARKED_PAID':
      messageText =
        `💳 PAYMENT MARKED AS PAID\n` +
        `----------------------------------------\n` +
        `📥 FOR BUYER (@${metadata.buyerUsername}):\n` +
        `• You marked this trade as paid. Kindly wait until the seller verifies your payment and releases the escrow. Do not cancel this trade.\n\n` +
        `⚠️ FOR SELLER (@${metadata.sellerUsername}):\n` +
        `• Buyer @${metadata.buyerUsername} has marked this trade as paid.\n` +
        `• Please check your bank or payment account directly to confirm the payment has arrived.\n` +
        `• Do NOT rely solely on buyer screenshots. Verify funds in your actual account before releasing crypto.`;
      break;

    case 'TRADE_RELEASED':
      messageText =
        `✅ TRADE COMPLETED SUCCESSFULLY\n` +
        `----------------------------------------\n` +
        `Seller @${metadata.sellerUsername} confirmed receipt and released ${amount} ${asset} from escrow.\n` +
        `• ${amount} ${asset} has been credited to @${metadata.buyerUsername}'s Paxones wallet.\n` +
        `• Please leave trade feedback below using only Positive or Negative.`;
      break;

    case 'TRADE_CANCELLED':
      messageText =
        `❌ TRADE CANCELLED\n` +
        `----------------------------------------\n` +
        `This trade was cancelled ${metadata.reason ? `(Reason: ${metadata.reason})` : ''}.\n` +
        `• Escrow handling follows the platform's trade-cancellation rules.\n` +
        `• IF YOU ALREADY SENT FUNDS: do NOT send again. Open a dispute and submit the official payment reference immediately.`;
      break;

    case 'TRADE_EXPIRED':
      messageText =
        `⚠️ TRADE EXPIRED (PAYMENT TIME EXCEEDED)\n` +
        `----------------------------------------\n` +
        `This trade has expired because the payment timer elapsed without confirmed payment.\n` +
        `• DO NOT MAKE PAYMENT: Coin is no longer held in escrow.\n` +
        `• IF YOU ALREADY PAID: Do not make another payment. Open a new trade again immediately with this seller or contact Paxones Support with your payment proof.`;
      break;

    case 'TRADE_DISPUTED':
      messageText =
        `🚨 DISPUTE OPENED — MODERATOR ESCALATION\n` +
        `----------------------------------------\n` +
        `• Disputed By: @${metadata.initiatorUsername} (${metadata.initiatorRole})\n` +
        `• Reason: ${metadata.reason || 'Payment or release conflict'}\n` +
        `• Payment Method: ${methodName}\n` +
        `----------------------------------------\n` +
        `📌 REQUIRED EVIDENCE:\n` +
        `1. Buyer: official payment proof showing reference, amount, date/time, and recipient details where appropriate.\n` +
        `2. Seller: official account/ledger evidence showing whether the funds were received, pending, reversed, or unavailable.\n` +
        `3. Keep communication inside this trade chat and do not share passwords, OTPs, PINs, or recovery secrets.\n` +
        `4. Moderator decisions should rely on provider records rather than screenshots alone.`;
      break;

    case 'TRADE_REPORTED':
      messageText =
        `🚩 ISSUE REPORTED TO RISK & COMPLIANCE\n` +
        `----------------------------------------\n` +
        `User @${metadata.initiatorUsername} (${metadata.initiatorRole}) submitted a report.\n` +
        `• Reason: ${metadata.reason || 'Suspicious activity or rule violation'}\n` +
        `• Payment Method: ${methodName}\n` +
        `• Do not share off-platform contact details or authentication credentials.`;
      break;

    case 'USER_BLOCKED':
      messageText =
        `⛔ USER BLOCK ALERT\n` +
        `----------------------------------------\n` +
        `@${metadata.initiatorUsername} (${metadata.initiatorRole}) has blocked @${metadata.targetUsername} (${metadata.targetRole}).\n` +
        `• Blocking does NOT cancel an active trade or release escrow automatically.\n` +
        `• Seller: verify payment directly before release.\n` +
        `• Buyer: do not cancel after sending funds; use dispute support if needed.`;
      break;

    case 'FEEDBACK_LEFT': {
      const badge = feedbackBadge(metadata.feedbackType);
      const guidance = feedbackGuidance(metadata.feedbackType);
      messageText =
        `⭐ FEEDBACK SUBMITTED\n` +
        `----------------------------------------\n` +
        `@${metadata.initiatorUsername} (${metadata.initiatorRole}) left ${badge} feedback for @${metadata.targetUsername}.\n` +
        `• Comment: "${metadata.feedbackComment || 'No comment provided.'}"\n` +
        `• Rating focus:\n` +
        guidance.map((x) => `  • ${x}`).join('\n');
      break;
    }
  }

  const { data, error } = await supabase.from('trade_messages').insert({
    trade_id: tradeId,
    sender_id: 'SYSTEM',
    is_system: true,
    message: messageText,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to send trade system message:', error);
  }

  return { data, error };
}

export function getSupportedPaymentMethods(): PaymentMethodProfile[] {
  return Object.values(PAYMENT_METHODS);
}

export function isSupportedPaymentMethod(methodName: string): boolean {
  return Boolean(resolvePaymentMethod('custom', methodName));
}

/**
 * ---------------------------------------------------------------------------
 * BACKWARD-COMPATIBILITY + CHAT SECURITY LAYER
 * ---------------------------------------------------------------------------
 */

export interface SystemMessagePayload {
  tradeId: string;
  type:
    | 'TRADE_INITIATED'
    | 'TRADE_STARTED'
    | 'ESCROW_LOCKED'
    | 'TRADE_COMPLETED'
    | 'TRADE_RELEASED'
    | 'TRADE_CANCELLED'
    | 'TRADE_EXPIRED'
    | 'TRADE_DISPUTED'
    | 'POSITIVE_FEEDBACK'
    | 'NEGATIVE_FEEDBACK'
    | 'USER_BLOCKED'
    | 'ISSUE_REPORTED'
    | 'MARKED_PAID'
    | 'MESSAGE_BLOCKED'
    | 'SECURITY_REMINDER'
    | 'CUSTOM';
  sellerUsername?: string;
  buyerUsername?: string;
  openerUsername?: string;
  blockedUsername?: string;
  initiatorRole?: 'Buyer' | 'Seller' | 'Trader' | string;
  targetRole?: 'Buyer' | 'Seller' | 'Trader' | string;
  coinAmount?: string | number;
  coinSymbol?: string;
  disputeReason?: string;
  disputeExplanation?: string;
  paymentMethod?: string;
  issueDetails?: string;
  issueCategory?: string;
  feedbackComment?: string;
  customText?: string;
  targetUserId?: string;
}

export function formatCryptoAmount(
  amount: number | string | undefined | null,
  symbol?: string
): string {
  const num = typeof amount === 'number' ? amount : Number(amount || 0);
  if (isNaN(num)) return '0.00';
  const s = (symbol || '').toUpperCase();
  if (s === 'USDT' || s === 'USDC' || s === 'DAI' || s === 'BUSD') {
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (num % 1 === 0) {
    return num.toFixed(2);
  }
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export function formatSystemMessageContent(
  payload: SystemMessagePayload
): string {
  const {
    type,
    sellerUsername = 'Seller',
    buyerUsername = 'Buyer',
    openerUsername = 'Trader',
    blockedUsername = 'User',
    initiatorRole = 'Buyer',
    targetRole = 'Seller',
    coinAmount = '0.00',
    coinSymbol = 'USDT',
    disputeReason = 'Payment issue',
    paymentMethod = '',
    issueDetails = '',
    issueCategory = '',
    feedbackComment = '',
    customText
  } = payload;

  const formattedAmount = formatCryptoAmount(coinAmount, coinSymbol);
  const cleanCoin = (coinSymbol || 'USDT').toUpperCase();
  const trimmedComment = (feedbackComment || customText || '')
    .trim()
    .slice(0, 100);

  switch (type) {
    case 'TRADE_INITIATED':
    case 'TRADE_STARTED':
    case 'ESCROW_LOCKED':
      return (
        `🔒 TRADE INITIATED\n` +
        `------------------------\n` +
        `• ${formattedAmount} ${cleanCoin} is safely held in Paxones Escrow.\n` +
        `• Buyer (@${buyerUsername}): Please transfer payment according to the seller's payment instructions before the timer expires, then click "I have paid".\n` +
        `• Seller (@${sellerUsername}): Do NOT release escrow until you have verified incoming funds in your own account/statement.\n` +
        `• Security: Never share passwords, OTPs, or communicate off-platform.`
      );

    case 'TRADE_COMPLETED':
    case 'TRADE_RELEASED':
      return (
        `@${sellerUsername} sold ${formattedAmount} ${cleanCoin} successfully to @${buyerUsername}.\n` +
        `@${buyerUsername} bought ${formattedAmount} ${cleanCoin} successfully from @${sellerUsername}.`
      );

    case 'TRADE_CANCELLED':
      return `Trade cancelled. Do not send or pay for this trade. If you have already made a payment, do not cancel or abandon the situation. Open a new trade immediately and contact Paxones Support if assistance is required.`;

    case 'TRADE_EXPIRED':
      return (
        `⚠️ TRADE EXPIRED (PAYMENT TIME EXCEEDED)\n` +
        `----------------------------------------\n` +
        `This trade has expired because the payment timer elapsed without confirmed payment.\n` +
        `• DO NOT MAKE PAYMENT: Coin is no longer held in escrow.\n` +
        `• IF YOU ALREADY PAID: Do not make another payment. Open a new trade again immediately with this seller or contact Paxones Support with your payment proof.`
      );

    case 'TRADE_DISPUTED': {
      let instructions = '';
      const method = (paymentMethod || '').toLowerCase();

      if (
        method.includes('bank') ||
        method.includes('wire') ||
        method.includes('sepa') ||
        method.includes('ach')
      ) {
        instructions =
          `Instructions for Bank Transfer:\n` +
          `1. Buyer: Upload official bank wire receipt/statement PDF showing sender, beneficiary account, reference code, and debit confirmation.\n` +
          `2. Seller: Upload bank statement PDF covering trade timeframe showing no credit matching reference.`;
      } else if (
        method.includes('upi') ||
        method.includes('imps') ||
        method.includes('gpay') ||
        method.includes('phonepe') ||
        method.includes('paytm')
      ) {
        instructions =
          `Instructions for UPI / IMPS:\n` +
          `1. Buyer: Submit full screenshot from payment app showing 12-digit UTR/Ref number, recipient UPI ID/account, and timestamp.\n` +
          `2. Seller: Provide bank account statement or video recording showing transaction timeline without incoming credit.`;
      } else if (method.includes('paypal')) {
        instructions =
          `Instructions for PayPal:\n` +
          `1. Buyer: Provide unedited screenshot of PayPal transaction details showing recipient email, transaction ID, and status.\n` +
          `2. Seller: Provide screenshot of PayPal balance/activity page demonstrating non-receipt or hold.`;
      } else if (
        method.includes('wise') ||
        method.includes('transferwise')
      ) {
        instructions =
          `Instructions for Wise:\n` +
          `1. Buyer: Upload official Wise transfer receipt PDF showing recipient details and 'Sent' status.\n` +
          `2. Seller: Upload screenshot of Wise multi-currency account activity for trade period.`;
      } else {
        instructions =
          `Instructions for ${paymentMethod || 'Selected Payment Method'}:\n` +
          `1. Buyer: Upload proof of payment (statement, receipt, transaction ID, or video confirmation).\n` +
          `2. Seller: Upload proof of non-receipt (account statement covering trade timeframe).`;
      }

      return (
        `Trade is now in dispute.\n` +
        `Reason: ${disputeReason}\n` +
        `Dispute opened by: @${openerUsername}\n\n` +
        `Please provide any requested evidence, documents, payment receipts, screenshots, or other supporting information within the specified timeframe.\n\n` +
        instructions
      );
    }

    case 'POSITIVE_FEEDBACK':
      return trimmedComment
        ? `@${openerUsername} left positive feedback "${trimmedComment}"`
        : `@${openerUsername} left positive feedback.`;

    case 'NEGATIVE_FEEDBACK':
      return trimmedComment
        ? `@${openerUsername} left negative feedback "${trimmedComment}"`
        : `@${openerUsername} left negative feedback.`;

    case 'USER_BLOCKED':
      return (
        `@${openerUsername} (${initiatorRole}) blocked @${blockedUsername} (${targetRole}). Do not cancel or release trade if funds were sent/received.`
      );

    case 'ISSUE_REPORTED':
      return (
        `@${openerUsername} reported an issue.` +
        `${issueCategory ? `\nCategory: ${issueCategory}` : ''}\n` +
        `Details: ${issueDetails}`
      );

    case 'MARKED_PAID':
      return (
        `Buyer @${buyerUsername} has marked the trade as paid. ` +
        `@${sellerUsername}, please validate payment in your receiving account before releasing.`
      );

    case 'MESSAGE_BLOCKED':
      return `Message blocked: For your security, off-platform communication or trading instructions are not permitted in Paxones Trade Chat. Please keep all trade-related communication within Paxones.`;

    case 'SECURITY_REMINDER':
      return `Paxones Security Reminder: Never share your password, 2FA code, private key, seed phrase, or recovery phrase with another user. Paxones Support will not ask you to disclose these credentials.`;

    default:
      return customText || 'Paxones System Notification';
  }
}

/**
 * Inserts an official Paxones System Message into the database.
 * If in the browser, dispatches via the secure /api/trades/[tradeId]/system-message route
 * to guarantee administrative insertion and Realtime synchronization.
 */
export async function insertPaxonesSystemMessage(
  supabase: SupabaseClient<any, any, any>,
  payload: SystemMessagePayload
): Promise<void> {
  const text = formatSystemMessageContent(payload);
  const now = new Date().toISOString();
  const systemUuid = '00000000-0000-0000-0000-000000000000';

  // 1. In browser environment: dispatch to server route for authorized service-role insertion
  if (typeof window !== 'undefined' && payload.tradeId) {
    try {
      const res = await fetch(`/api/trades/${encodeURIComponent(payload.tradeId)}/system-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: payload.type,
          metadata: payload,
          customText: payload.customText
        })
      });
      if (res.ok) return;
    } catch (e) {
      console.warn('System message API route dispatch failed, falling back to direct client attempt:', e);
    }
  }

  // 2. Direct database insertion (server-side context or fallback)
  try {
    const { error } = await supabase.from('trade_messages').insert([
      {
        trade_id: payload.tradeId,
        sender_id: systemUuid,
        sender_username: 'Paxones System',
        message: text,
        is_moderator: true,
        visibility: 'all',
        created_at: now
      }
    ]);

    if (error) {
      // If extra columns do not exist in database schema, fallback to core schema
      const baseFallback = await supabase.from('trade_messages').insert([
        {
          trade_id: payload.tradeId,
          sender_id: systemUuid,
          message: text,
          created_at: now
        }
      ]);
      if (baseFallback.error) {
        console.warn('Error inserting into trade_messages:', baseFallback.error);
      }
    }
  } catch (err) {
    console.warn('Error inserting into trade_messages:', err);
  }

  try {
    const { error } = await supabase
      .from('trade_chat_messages')
      .insert([
        {
          trade_id: payload.tradeId,
          sender_id: systemUuid,
          message: text,
          is_system_message: true,
          created_at: now
        }
      ]);

    if (error) {
      console.warn('Optional trade_chat_messages insert failed:', error);
    }
  } catch {
    // Optional fallback; keep the primary system message path non-fatal.
  }
}

/**
 * Restricted keywords and patterns for off-platform communication protection.
 */
export const OFF_PLATFORM_KEYWORDS = [
  'whatsapp',
  "what's app",
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
  /(?:^|\s)@([a-zA-Z0-9_.]{4,32})/i,
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{10,12}\b/,
  /(?:call|text|reach|msg|dm|ping|contact)\s+(?:me|us)?\s*(?:on|at|via)?\s*(?:whatsapp|wa|tg|telegram|insta|ig|discord|phone)/i,
  /(?:my\s+(?:number|whatsapp|telegram|tg|phone|digits)\s+(?:is|:))/i
];

/**
 * Checks whether a message contains prohibited off-platform
 * communication keywords or patterns.
 */
export function checkOffPlatformMessage(text: string): {
  isBlocked: boolean;
  matchedTerm?: string;
} {
  if (!text) return { isBlocked: false };

  const lower = text.toLowerCase();

  for (const keyword of OFF_PLATFORM_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { isBlocked: true, matchedTerm: keyword };
    }
  }

  for (const pattern of OFF_PLATFORM_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return { isBlocked: true, matchedTerm: 'contact pattern' };
    }
  }

  return { isBlocked: false };
}

/**
 * Extract URLs from a message for phishing protection.
 */
export const URL_REGEX = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;

export function extractUrls(text: string): string[] {
  if (!text) return [];

  const matches = text.match(URL_REGEX);
  return matches ? Array.from(new Set(matches)) : [];
}
