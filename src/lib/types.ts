
'use client';
import { Timestamp } from "firebase/firestore";

export type CryptoCurrency = "BTC" | "ETH" | "USDT" | "LTC" | "BNB" | "MATIC" | "TRX";

export type SupportedCrypto = {
  name: CryptoCurrency;
  chains: string[];
}

export type Language = {
  code: string;
  name: string;
  nativeName: string;
  dialects?: Language[];
}

export type DepositAddressSet = {
  id: string; // "1", "2", ... "20"
  setName: string; // e.g., "Set 1"
  addresses: {
    [key: string]: string; // e.g., "BTC-Bitcoin": "...", "USDT-ERC20": "..."
  };
};

export type Deposit = {
  id: string;
  userId: string;
  userDisplayName: string;
  crypto: CryptoCurrency;
  chain: string;
  amount: number;
  txId?: string; // Optional at first, provided by user
  walletAddress: string; // The address the user must send to
  qrCodeUrl?: string; // The QR for that address
  status: 'pending' | 'awaiting_confirmation' | 'approved' | 'declined' | 'expired'; // More specific statuses
  finalAmount?: number; // Admin can correct the amount
  adminId?: string;
  createdAt: string; // Use ISO string
  timerEnd: string; // When the pending request expires
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
  fee?: number; // Total transaction fee
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
    }
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

export type P2PAd = {
  id: string;
  publicAdId: string;
  userId: string;
  user: {
      username: string;
      country?: string;
      feedbackScore: number;
      positiveFeedback: number;
      negativeFeedback: number;
      completedTrades: number;
      photoURL?: string;
      badges?: string[];
      lastActive?: string;
  }
  adType: "buy" | "sell";
  crypto: CryptoCurrency;
  fiatCurrency: string;
  paymentMethods: string[];
  rateType: "market" | "fixed";
  ratePercent?: number;
  fixedRate?: number;
  minAmount: number;
  maxAmount: number;
  paymentTimeLimit: number;
  terms: string;
  offerLabel?: string;
  tags?: string[];
  active: boolean;
  deletedAt?: string;
  createdAt: string;
  targetedCountries?: string[];
  blockedCountries?: string[];
  minCompletedTrades?: number;
};

export type TradeStatus = "active" | "paid" | "released" | "disputed" | "cancelled" | "expired";

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
}

export type Dispute = {
    id: string;
    tradeId: string;
    openedBy: string;
    reason: string;
    explanation: string;
    status: 'open' | 'resolved' | 'cancelled';
    resolvedBy?: string; // Admin UID
    winnerId?: string; // User UID of winner
    resolutionNote?: string;
    createdAt: string;
}

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
    targetId: string; // Can be userId, tradeId, etc.
    createdAt: string;
};

export type PaymentMethod = {
    id: string;
    name: string;
    country: string;
}

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
}

export type EscrowLedger = {
    id: string;
    tradeId: string;
    feeAmount: number;
    crypto: CryptoCurrency;
    createdAt: string;
}

export type Session = {
    id: string;
    userId: string;
    userAgent: string;
    ipAddress: string;
    lastLogin: string;
    isActive: boolean;
}

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
}

export type Notification = {
    id: string;
    userId: string;
    message: string;
    link?: string;
    isRead: boolean;
    createdAt: string;
}

    