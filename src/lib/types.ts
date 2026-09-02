'use client';

export type CryptoCurrency = 'BTC' | 'ETH' | 'LTC' | 'USDT' | 'BNB' | 'MATIC' | 'TRX';

export interface CurrencyConfig {
  code: string;
  name: string;
  symbol: string;
  flagCode?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  country?: string;
  feedbackScore: number;
  avgReleaseTime: number; // in minutes
  completedTrades: number;
  lastActive: string | Date;
  badges?: string[];
}

export interface P2PAd {
  id: string;
  userId: string;
  publicAdId?: string;
  user?: {
    username: string;
    country?: string;
    feedbackScore: number;
    positiveFeedback?: number;
    negativeFeedback?: number;
    completedTrades: number;
    photoURL?: string;
    badges?: string[];
    lastActive?: string;
    isVerified?: boolean;
    is_verified?: boolean;
  };
  adType: 'buy' | 'sell';
  crypto: CryptoCurrency;
  fiatCurrency: string;
  rateType: 'fixed' | 'floating' | 'market';
  fixedRate?: number;
  ratePercent?: number;
  minAmount: number;
  maxAmount: number;
  paymentMethods: string[];
  offerLabel?: string;
  tags?: string[];
  terms: string;
  paymentTimeLimit?: number;
  payment_window?: number;
  active?: boolean;
  status?: string;
  targetedCountries?: string[];
  blockedCountries?: string[];
  minCompletedTrades?: number;
  createdAt?: string;
}

export interface InitiateTradePayload {
  adId: string;
  cryptoAmount: number;
  fiatAmount: number;
  fiatAmountInUSD: number;
  paymentMethod: string;
}

export type SupportedCrypto = {
  name: CryptoCurrency;
  chains: string[];
};

export type Language = {
  code: string;
  name: string;
  nativeName: string;
  dialects?: Language[];
};

export type DepositAddressSet = {
  id: string;
  setName: string;
  addresses: {
    [key: string]: string;
  };
};

export type Deposit = {
  id: string;
  userId: string;
  userDisplayName: string;
  crypto: CryptoCurrency;
  chain: string;
  amount: number;
  txId?: string;
  walletAddress: string;
  qrCodeUrl?: string;
  status: 'pending' | 'awaiting_confirmation' | 'approved' | 'declined' | 'expired';
  finalAmount?: number;
  adminId?: string;
  createdAt: string;
  timerEnd: string;
  walletIndex?: number;
};

export type Withdrawal = {
  id: string;
  userId: string;
  userDisplayName: string;
  crypto: CryptoCurrency;
  chain: string;
  address: string;
  amount: number;
  fee?: number;
  status: 'pending' | 'approved' | 'declined' | 'cancelled';
  txHash?: string;
  adminId?: string;
  createdAt: string;
};

export type User = {
  id: string;
  userId: string;
  oldUserId?: string;
  fullName: string;
  dob: string;
  country?: string;
  ipBasedCountry?: string;
  photoURL?: string;
  wallets?: {
    [key in CryptoCurrency]?: {
      balance: number;
      lockedBalance: number;
    };
  };
  isBanned: boolean;
  isOnHold: boolean;
  tradeVolume: number;
  completedTrades: number;
  feedbackScore: number;
  positiveFeedback: number;
  negativeFeedback: number;
  avgPaymentTime: number;
  avgReleaseTime: number;
  usernameChanged: boolean;
  createdAt: string;
  lastTradeAt?: string;
  lastActive?: string;
  preferredCurrency?: string;
  blockedUsers?: string[];
  badges?: string[];
  isAdminAccount?: boolean;
  walletIndex?: number;
  securityQuestion?: string;
  securityAnswer?: string;
};

export type TradeStatus = 'active' | 'paid' | 'released' | 'disputed' | 'cancelled' | 'expired';

export type Trade = {
  id: string;
  tradeId: string;
  adId: string;
  buyerId: string;
  sellerId: string;
  buyer: { username: string; country?: string };
  seller: { username: string; country?: string };
  crypto: CryptoCurrency;
  amount: number;
  escrowFee: number;
  fiatCurrency: string;
  fiatAmount: number;
  fiatAmountInUSD?: number;
  paymentMethod: string;
  price: number;
  status: TradeStatus;
  claimedByBuyer: boolean;
  paymentReceiptUrl?: string;
  cancellationReason?: string;
  expiresAt: string;
  paidAt?: string;
  releasedAt?: string;
  createdAt: string;
};

export type TradeChatMessage = {
  id: string;
  tradeId: string;
  senderId: string;
  senderUsername: string;
  message: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'none';
  isModerator: boolean;
  createdAt: string;
};

export type Dispute = {
  id: string;
  tradeId: string;
  openedBy: string;
  reason: string;
  explanation: string;
  status: 'open' | 'resolved' | 'cancelled';
  resolvedBy?: string;
  winnerId?: string;
  resolutionNote?: string;
  createdAt: string;
};

export type Feedback = {
  id: string;
  tradeId: string;
  fromUser: string;
  fromUsername: string;
  toUser: string;
  rating: 'positive' | 'negative';
  comment: string;
  createdAt: string;
};

export type AdminLog = {
  id: string;
  adminId: string;
  action: string;
  targetId: string;
  createdAt: string;
};

export type PaymentMethod = {
  id: string;
  name: string;
  country: string;
};

export type SupportTicket = {
  id: string;
  email: string;
  userId?: string;
  message: string;
  status: 'Open' | 'In Progress' | 'Closed';
  resolutionNote?: string;
  createdAt: string;
};

export type AdminRole = {
  role: 'admin';
  createdAt: string;
};

export type EscrowLedger = {
  id: string;
  tradeId: string;
  feeAmount: number;
  crypto: CryptoCurrency;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: string;
  userAgent: string;
  ipAddress: string;
  lastLogin: string;
  isActive: boolean;
};

export type CoinTransfer = {
  id: string;
  publicId: string;
  senderId: string;
  recipientId: string;
  senderUsername: string;
  recipientUsername: string;
  crypto: CryptoCurrency;
  amount: number;
  createdAt: string;
};

export type Notification = {
  id: string;
  userId: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
};
