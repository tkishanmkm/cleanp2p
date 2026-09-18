'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useStopwatch } from '@/hooks/use-stopwatch';
import { useCountdown } from '@/hooks/use-countdown';
import { useUserTimezone } from '@/hooks/use-user-timezone';
import { formatUserDateTimeArial, formatUserChatTime, formatUtcDateTime } from '@/lib/date-utils';
import { TradeChatTimer } from '@/components/trade-chat-timer';
import { addReceiptToTrade, claimFundsForTrade } from '@/lib/wallet';
import { compressImage } from '@/lib/media-compression';
import { cn, toDate } from '@/lib/utils';
import { insertPaxonesSystemMessage, checkOffPlatformMessage, extractUrls, formatCryptoAmount } from '@/lib/trade-system-messages';
import type { Trade, User } from '@/lib/types';

import { Card, CardContent, CardHeader, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { DefaultAvatar, BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { FlagIcon } from '@/components/ui/flag-icon';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Clock,
  Send,
  Info as InfoIcon,
  Loader2,
  ThumbsUp,
  ThumbsDown,
  Paperclip,
  Lock,
  FileText,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Scale,
  Ban,
  UserCheck,
  Download,
  ImageIcon
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { usePresenceStatus, resolveUserLastSeen } from '@/lib/presence';

function CoinInsignia({ symbol, className = 'h-4 w-4' }: { symbol: string; className?: string }) {
  const s = (symbol || '').toUpperCase();
  switch (s) {
    case 'BTC':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <BtcLogo className={className} />
          <span>BTC</span>
        </span>
      );
    case 'ETH':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <EthLogo className={className} />
          <span>ETH</span>
        </span>
      );
    case 'USDT':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <UsdtLogo className={className} />
          <span>USDT</span>
        </span>
      );
    case 'LTC':
      return (
        <span className="inline-flex items-center gap-1 font-bold font-mono">
          <LtcLogo className={className} />
          <span>LTC</span>
        </span>
      );
    default:
      return <span className="font-bold font-mono">{symbol}</span>;
  }
}

function getPositiveVal(...values: any[]): number {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') {
      const num = Number(v);
      if (!isNaN(num) && num > 0) return num;
    }
  }
  return 0;
}

function TradeInstructions({
  trade,
  isBuyer,
  opponentUsername,
}: {
  trade: Trade | any;
  isBuyer: boolean;
  opponentUsername?: string;
}) {
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }
  
  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || 'USD';

  const coinAmount = rawCrypto > 0 ? (rawCrypto < 0.01 ? rawCrypto.toFixed(6) : rawCrypto.toFixed(2)) : '0.00';
  const fiatAmount = rawFiat > 0 ? rawFiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';

  const partnerName = opponentUsername ? `@${opponentUsername}` : (isBuyer ? '@Seller' : '@Buyer');

  const buyerInstructions = [
    `Wait for the seller (${partnerName}) to provide their payment details in the chat.`,
    'Make your payment using the details provided.',
    "Mark the trade as 'Paid' by clicking 'I Have Paid' before the countdown ends.",
    `Wait for ${partnerName} to confirm receipt in their account.`,
    'Your trade partner will release the coin from escrow.'
  ];
  const sellerInstructions = [
    'Share your payment instructions in the chat.',
    `Wait for ${partnerName} to make the payment.`,
    'Once payment is received in your account, release the coin.',
    'Do not release funds based on payment proof alone. Always check your bank/wallet.',
    "If the buyer doesn't pay within the countdown, the trade will automatically expire."
  ];

  const instructions = isBuyer ? buyerInstructions : sellerInstructions;

  return (
    <div className="p-4 bg-muted/50 dark:bg-slate-800/80 rounded-2xl border border-border/80 dark:border-slate-800 mb-4 text-sm space-y-2.5">
      <p className="font-semibold text-foreground">
        {isBuyer ? "You're buying " : "You're selling "}
        <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{coinAmount} {coinSymbol}</strong> for{' '}
        <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{fiatAmount} {fiatCurrency}</strong>.
      </p>
      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
        <li>Coin deposit ({coinAmount} {coinSymbol} + 1.5% Fee) is locked securely in Escrow.</li>
        {instructions.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
    </div>
  );
}

function PostTradeCompletionCard({
  trade,
  isBuyer,
  opponentUsername,
  onOpenExternalLink
}: {
  trade: Trade | any;
  isBuyer: boolean;
  opponentUsername: string;
  onOpenExternalLink: (url: string) => void;
}) {
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }
  
  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || 'USD';

  const coinAmount = rawCrypto > 0 ? (rawCrypto < 0.01 ? rawCrypto.toFixed(6) : rawCrypto.toFixed(2)) : '0.00';
  const fiatAmount = rawFiat > 0 ? rawFiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
  const priceFormatted = rawRate > 0 
    ? rawRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (rawFiat > 0 && rawCrypto > 0 ? (rawFiat / rawCrypto).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-background p-4 sm:p-5 my-3 shadow-md text-foreground">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="h-9 w-9 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm sm:text-base text-foreground">Trade Successfully Completed!</h3>
          <p className="text-xs text-muted-foreground">
            {isBuyer
              ? `You received ${coinAmount} ${coinSymbol} in your Paxones wallet.`
              : `You sold ${coinAmount} ${coinSymbol} to @${opponentUsername}.`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 my-3 p-3 rounded-xl bg-background/60 border border-border/60 text-xs">
        <div>
          <span className="text-muted-foreground text-[11px] block">Amount Transferred</span>
          <span className="font-bold text-foreground font-mono">{coinAmount} {coinSymbol}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-[11px] block">Total Fiat</span>
          <span className="font-bold text-foreground font-mono">{fiatAmount} {fiatCurrency}</span>
        </div>
        <div className="col-span-2 pt-1.5 border-t border-border/40 flex justify-between text-[11px]">
          <span className="text-muted-foreground">Exchange Rate</span>
          <span className="font-semibold text-foreground">1 {coinSymbol} = {priceFormatted} {fiatCurrency}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button
          size="sm"
          className="w-full bg-[#00b67a] hover:bg-[#009b67] text-white font-bold text-xs gap-1.5 shadow-sm"
          onClick={() => onOpenExternalLink('https://www.trustpilot.com/review/paxones.com')}
        >
          <span>★ Rate Us on Trustpilot</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Enhanced System Message bubble with official Paxones badge, color accents,
 * and high-contrast readable styling.
 */
function PaxonesSystemMessageBubble({
  msg,
  onOpenExternalLink,
  timezone
}: {
  msg: any;
  onOpenExternalLink: (url: string) => void;
  timezone?: string;
}) {
  const text = msg.message || '';
  const timestamp = msg.createdAt || msg.created_at;
  const timeString = formatUserDateTimeArial(timestamp, timezone) || '';

  // Determine system message category
  const isInitiated = text.includes('PAXONES ESCROW SECURED') || text.includes('safely held in Paxones Escrow') || text.includes('Escrow Secured');
  const isExpired = text.toLowerCase().includes('expired') || text.toLowerCase().includes('coin is no longer held');
  const isCompleted = !isExpired && ((text.includes('sold') && text.includes('successfully')) || (text.includes('bought') && text.includes('successfully')) || text.includes('Trade Completed') || text.includes('released'));
  const isCancelled = !isExpired && (text.toLowerCase().includes('trade cancelled') || text.toLowerCase().includes('cancelled.'));
  const isDispute = text.includes('in dispute') || text.includes('DISPUTE') || text.includes('Dispute Assistant') || text.includes('Dispute Notice');
  const isBlockedUser = text.includes('blocked @') || text.includes('User Blocked');
  const isPositiveFeedback = text.includes('positive feedback');
  const isNegativeFeedback = text.includes('negative feedback');
  const isIssueReported = text.includes('reported an issue') || text.includes('Issue Reported');
  const isMessageBlocked = text.includes('Message blocked:') || text.includes('off-platform communication');
  const isPaid = text.includes('confirmed payment') || text.includes('Marked as Paid') || text.includes('marked as paid');
  const isSecurityReminder = text.includes('Paxones Security Reminder');

  let title = 'Paxones System';
  let badgeClass = 'bg-primary/10 text-primary border-primary/20';
  let containerClass = 'bg-muted/60 border-border/80 text-foreground';
  let IconComponent = ShieldCheck;

  if (isInitiated) {
    title = 'Escrow Secured';
    badgeClass = 'bg-primary/20 text-primary border-primary/40 font-bold';
    containerClass = 'bg-primary/10 border-primary/30 text-foreground';
    IconComponent = ShieldCheck;
  } else if (isExpired) {
    title = 'Trade Expired';
    badgeClass = 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40 font-bold';
    containerClass = 'bg-rose-500/10 border-rose-500/35 text-rose-950 dark:text-rose-100';
    IconComponent = AlertTriangle;
  } else if (isCompleted) {
    title = 'Trade Completed';
    badgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    containerClass = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100';
    IconComponent = CheckCircle2;
  } else if (isCancelled) {
    title = 'Trade Cancelled';
    badgeClass = 'bg-destructive/15 text-destructive border-destructive/30';
    containerClass = 'bg-destructive/10 border-destructive/30 text-destructive dark:text-rose-200';
    IconComponent = XCircle;
  } else if (isDispute) {
    title = 'Official Dispute Notice';
    badgeClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    containerClass = 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100';
    IconComponent = Scale;
  } else if (isBlockedUser) {
    title = 'User Blocked Notice';
    badgeClass = 'bg-destructive/15 text-destructive border-destructive/30';
    containerClass = 'bg-destructive/10 border-destructive/30 text-destructive dark:text-rose-200';
    IconComponent = Ban;
  } else if (isPositiveFeedback) {
    title = 'Positive Feedback Left';
    badgeClass = 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30';
    containerClass = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100';
    IconComponent = ThumbsUp;
  } else if (isNegativeFeedback) {
    title = 'Negative Feedback Left';
    badgeClass = 'bg-destructive/15 text-destructive border-destructive/30';
    containerClass = 'bg-destructive/10 border-destructive/30 text-destructive dark:text-rose-200';
    IconComponent = ThumbsDown;
  } else if (isIssueReported) {
    title = 'Issue Reported';
    badgeClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    containerClass = 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100';
    IconComponent = AlertTriangle;
  } else if (isMessageBlocked) {
    title = 'Security Alert: Message Blocked';
    badgeClass = 'bg-destructive/15 text-destructive border-destructive/30';
    containerClass = 'bg-destructive/10 border-destructive/30 text-destructive dark:text-rose-200';
    IconComponent = ShieldAlert;
  } else if (isPaid) {
    title = 'Payment Confirmed';
    badgeClass = 'bg-primary/15 text-primary border-primary/30';
    containerClass = 'bg-primary/10 border-primary/30 text-foreground';
    IconComponent = UserCheck;
  } else if (isSecurityReminder) {
    title = 'Paxones Security Reminder';
    badgeClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    containerClass = 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100';
    IconComponent = ShieldCheck;
  }

  // Format message text: highlight @mentions and lines
  const lines = text.split('\n');

  return (
    <div className={cn('rounded-xl border p-3.5 my-2.5 text-xs transition-all shadow-xs', containerClass)}>
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-current/15">
        <div className="flex items-center gap-1.5 font-bold tracking-tight">
          <IconComponent className="h-4 w-4 shrink-0" />
          <span>{title}</span>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border', badgeClass)}>
          PAXONES SYSTEM
        </span>
      </div>

      <div className="space-y-1.5 text-left text-xs leading-relaxed whitespace-pre-wrap font-sans">
        {lines.map((line: string, i: number) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-1" />;

          // Highlight @usernames
          const parts = line.split(/(@\w+)/g);

          return (
            <p key={i} className={cn(trimmed.startsWith('Important:') || trimmed.startsWith('Reason:') || trimmed.startsWith('• DO NOT') ? 'font-semibold' : '')}>
              {parts.map((part, pIdx) => {
                if (part.startsWith('@')) {
                  return (
                    <span key={pIdx} className="font-bold underline decoration-dotted">
                      {part}
                    </span>
                  );
                }
                return part;
              })}
            </p>
          );
        })}
      </div>

      <div className="flex items-center justify-end mt-2 pt-1 border-t border-current/10 text-[10px] opacity-75 font-mono">
        <span title={formatUtcDateTime(timestamp)} className="font-[Arial,Helvetica,sans-serif]">{timeString}</span>
      </div>
    </div>
  );
}

/**
 * Text renderer that wraps URLs with a secure click interceptor to trigger the Phishing Warning Modal.
 */
function FormattedUserMessage({
  content,
  onOpenExternalLink
}: {
  content: string;
  onOpenExternalLink: (url: string) => void;
}) {
  if (!content) return null;

  // Regex to match URLs and @mentions
  const tokens = content.split(/(https?:\/\/[^\s]+|www\.[^\s]+|@\w+)/gi);

  return (
    <span className="whitespace-pre-wrap leading-relaxed break-words">
      {tokens.map((token, idx) => {
        if (/^https?:\/\//i.test(token) || /^www\./i.test(token)) {
          const fullUrl = token.startsWith('http') ? token : `https://${token}`;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onOpenExternalLink(fullUrl)}
              className="inline-flex items-center gap-0.5 font-bold underline underline-offset-2 text-primary hover:text-primary/80 transition-colors mx-0.5 text-xs"
              title="Click to open external link security check"
            >
              <span>{token}</span>
              <ExternalLink className="h-3 w-3 inline" />
            </button>
          );
        }

        if (/^@\w+/i.test(token)) {
          return (
            <span key={idx} className="font-bold bg-primary/15 px-1 py-0.5 rounded text-[11px] mx-0.5">
              {token}
            </span>
          );
        }

        return token;
      })}
    </span>
  );
}

const TradeSummaryBar = ({ trade, currentUserRole }: { trade: Trade | any; currentUserRole: 'buy' | 'sell' }) => {
  const isBuyer = currentUserRole === 'buy';
  const roleText = isBuyer ? 'Buying' : 'Selling';

  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }

  const coinAmount = formatCryptoAmount(rawCrypto, coinSymbol);
  const fiatAmount = rawFiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || 'USD';

  return (
    <div
      className={cn(
        'px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold border flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 shadow-xs transition-all',
        isBuyer
          ? 'bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
          : 'bg-rose-500/10 dark:bg-rose-500/15 border-rose-500/30 text-rose-800 dark:text-rose-300'
      )}
    >
      <span className="font-bold tracking-tight">{roleText}</span>
      <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">{coinAmount}</span>
      <CoinInsignia symbol={coinSymbol} className="h-4 w-4" />
      <span className="font-medium opacity-90">for</span>
      <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">
        {fiatAmount}
      </span>
      <span className="font-sans font-bold">{fiatCurrency}</span>
    </div>
  );
};

export function TradeChat({
  currentUserId,
  trade,
  opponent,
  isAdmin,
  sellerTerms,
  onInfoClick
}: {
  currentUserId: string;
  trade: Trade | any;
  opponent: User | any;
  isAdmin: boolean;
  sellerTerms?: string;
  onInfoClick: () => void;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [areMessagesLoading, setAreMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentProfileUsername, setCurrentProfileUsername] = useState<string>('Trader');

  useEffect(() => {
    if (!currentUserId) return;
    supabase.from('profiles').select('username').eq('id', currentUserId).maybeSingle().then(({ data }) => {
      if (data?.username) setCurrentProfileUsername(data.username);
    });
  }, [currentUserId, supabase]);

  // External link security modal state (only for typed chat web links)
  const [selectedExternalUrl, setSelectedExternalUrl] = useState<string | null>(null);

  // In-app media lightbox modal state for uploaded trade attachments
  const [previewMedia, setPreviewMedia] = useState<{ url: string; type: string; filename?: string; isPdf?: boolean; isCsv?: boolean; isText?: boolean } | null>(null);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [isLoadingPreviewContent, setIsLoadingPreviewContent] = useState(false);

  // Dynamic live feedback state for opponent in chat header
  const [liveOpponentFeedback, setLiveOpponentFeedback] = useState<{ positive: number; negative: number }>({
    positive: Number(opponent?.positiveFeedback ?? opponent?.positive_feedback ?? 0),
    negative: Number(opponent?.negativeFeedback ?? opponent?.negative_feedback ?? 0)
  });

  useEffect(() => {
    setLiveOpponentFeedback({
      positive: Number(opponent?.positiveFeedback ?? opponent?.positive_feedback ?? 0),
      negative: Number(opponent?.negativeFeedback ?? opponent?.negative_feedback ?? 0)
    });
  }, [opponent?.positiveFeedback, opponent?.positive_feedback, opponent?.negativeFeedback, opponent?.negative_feedback]);

  // Realtime subscription to feedback changes to immediately update positive/negative counts
  useEffect(() => {
    const oppId = opponent?.id;
    if (!oppId) return;

    const fetchCounts = async () => {
      const { data: fbData } = await supabase
        .from('feedback')
        .select('rating, is_positive')
        .eq('to_user', oppId);

      if (fbData) {
        const pos = fbData.filter((f) => f.is_positive === true || f.is_positive === 'true' || f.rating === 'positive').length;
        const neg = fbData.filter((f) => f.is_positive === false || f.is_positive === 'false' || f.rating === 'negative').length;
        setLiveOpponentFeedback({
          positive: pos,
          negative: neg
        });
      }
    };

    fetchCounts();

    const fbChannel = supabase
      .channel(`feedback-chat-counts-${oppId}-${Math.random().toString(36).substring(2, 7)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feedback', filter: `to_user=eq.${oppId}` },
        () => {
          fetchCounts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(fbChannel);
    };
  }, [opponent?.id, supabase]);

  const openAttachmentPreview = async (rawUrl: string, mediaType: string) => {
    const displayUrl = getMediaDisplayUrl(rawUrl);
    const lowerUrl = (rawUrl || '').toLowerCase();
    const isPdf = lowerUrl.includes('.pdf') || mediaType === 'pdf';
    const isCsv = lowerUrl.includes('.csv');
    const isText = lowerUrl.includes('.txt') || lowerUrl.includes('.json') || lowerUrl.includes('.log');
    const extractedFilename = rawUrl.split('/').pop()?.split('?')[0] || 'Attachment';

    setCsvContent(null);
    setTextContent(null);

    setPreviewMedia({
      url: displayUrl,
      type: mediaType,
      filename: extractedFilename,
      isPdf,
      isCsv,
      isText,
    });

    if (isCsv || isText) {
      setIsLoadingPreviewContent(true);
      try {
        const res = await fetch(displayUrl);
        const text = await res.text();
        if (isCsv) setCsvContent(text);
        else setTextContent(text);
      } catch (err) {
        console.error('Failed to preview text/csv file:', err);
      } finally {
        setIsLoadingPreviewContent(false);
      }
    }
  };

  // Dispute privacy modal state
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [disputeVisibility, setDisputeVisibility] = useState<'all' | 'moderator_only'>('all');
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);

  const getMediaDisplayUrl = (url?: string) => {
    if (!url) return '';
    if (url.startsWith('/api/') || url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }
    if (url.includes('backblazeb2.com') || url.startsWith('trades/')) {
      return `/api/trade/media?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  const { timezone } = useUserTimezone();
  const resolveTradeStatus = (t: any): string => {
    if (!t) return 'active';
    const st = (t.status || '').toLowerCase();
    if (['released', 'completed'].includes(st)) return 'released';
    if (st === 'cancelled') return 'cancelled';
    if (st === 'disputed' || st === 'dispute') return 'disputed';
    if (st === 'expired') return 'expired';
    if (t.paid_at || t.marked_paid_at || t.payment_confirmed_at || t.escrow_status === 'PAID' || ['paid', 'buyer_marked_paid', 'payment_sent'].includes(st)) {
      return 'paid';
    }
    return st || 'active';
  };

  const tradeStatus = resolveTradeStatus(trade);
  const isTradeStopped = ['released', 'cancelled', 'expired', 'completed'].includes(tradeStatus);
  const isDisputed = ['disputed', 'dispute'].includes(tradeStatus);

  // Freeze stopwatch at exact finish time
  const stopEndTime = trade?.releasedAt || trade?.released_at || trade?.cancelledAt || trade?.cancelled_at || trade?.updated_at;
  const stopwatch = useStopwatch(trade?.createdAt || trade?.created_at || Date.now(), isTradeStopped, stopEndTime);

  // Reverse countdown timer based on ad's time limit
  const timeLimitMinutes = Number(
    trade?.payment_window_minutes ??
    trade?.payment_time_limit ??
    trade?.time_limit ??
    trade?.ad?.payment_window_minutes ??
    trade?.ad?.payment_window ??
    trade?.ad?.payment_time_limit ??
    30
  );

  const expiresDate = useMemo(() => {
    if (trade?.expires_at || trade?.expiresAt) {
      return new Date(trade?.expires_at || trade?.expiresAt);
    }
    const start = new Date(trade?.createdAt || trade?.created_at || Date.now()).getTime();
    return new Date(start + timeLimitMinutes * 60 * 1000);
  }, [trade?.createdAt, trade?.created_at, trade?.expires_at, trade?.expiresAt, timeLimitMinutes]);

  const isCountdownActive = !isTradeStopped && (tradeStatus === 'active' || tradeStatus === 'pending');
  const countdown = useCountdown(isCountdownActive ? expiresDate : new Date(0));
  const isExpired = tradeStatus === 'expired' || (isCountdownActive && (countdown.isFinished || (expiresDate.getTime() > 0 && expiresDate.getTime() <= Date.now())));
  const effectiveTradeStatus = isExpired ? 'expired' : tradeStatus;

  const tradeId = trade?.id;
  const isBuyer = currentUserId === (trade?.buyerId || trade?.buyer_id);
  const userRoleLabel = isBuyer ? 'Buyer' : 'Seller';

  // Auto-expire trade and post system message if timer is finished
  useEffect(() => {
    let isMounted = true;
    const triggerExpire = async () => {
      if (isExpired && tradeStatus !== 'expired' && tradeId) {
        try {
          // Post official system message for expiration
          await fetch(`/api/trades/${encodeURIComponent(tradeId)}/system-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'TRADE_EXPIRED',
              metadata: {
                buyerUsername: isBuyer ? currentProfileUsername : (opponent?.username || 'Buyer'),
                sellerUsername: isBuyer ? (opponent?.username || 'Seller') : currentProfileUsername,
                coinAmount: trade?.crypto_amount || trade?.amount,
                coinSymbol: trade?.crypto || trade?.asset_symbol || 'USDT'
              }
            })
          }).catch(() => {});

          // Trigger trade status update and backend expiration handler
          await fetch(`/api/trades/${encodeURIComponent(tradeId)}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'EXPIRE_TRADE' })
          });
        } catch (e) {
          console.error('Failed to auto-expire trade in chat:', e);
        }
      }
    };
    triggerExpire();
    return () => {
      isMounted = false;
    };
  }, [isExpired, tradeStatus, tradeId, isBuyer, opponent?.username, trade?.crypto_amount, trade?.amount, trade?.crypto, trade?.asset_symbol]);

  // Persist duration_seconds to trade record upon completion
  useEffect(() => {
    if (isTradeStopped && tradeId) {
      const persistDuration = async () => {
        try {
          const startMs = new Date(trade?.createdAt || trade?.created_at || Date.now()).getTime();
          const endMs = stopEndTime ? new Date(stopEndTime).getTime() : Date.now();
          const duration = Math.max(1, Math.floor((endMs - startMs) / 1000));
          if (!isNaN(duration) && (!trade?.duration_seconds || trade?.duration_seconds === null)) {
            await supabase.from('trades').update({ duration_seconds: duration }).eq('id', tradeId);
          }
        } catch {}
      };
      persistDuration();
    }
  }, [isTradeStopped, tradeId, trade, stopEndTime, supabase]);

  // Fetch initial messages & subscribe to Realtime
  useEffect(() => {
    if (!tradeId) return;

    const fetchMessages = async () => {
      setAreMessagesLoading(true);
      const { data, error } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });

      if (error) {
        toast({ variant: 'destructive', title: 'Error loading messages', description: error.message });
      } else {
        const mapped = (data || []).map((m: any) => ({
          id: m.id,
          tradeId: m.trade_id,
          senderId: m.sender_id,
          senderUsername: m.sender_username,
          message: m.message,
          mediaUrl: m.media_url,
          mediaType: m.media_type,
          visibility: m.visibility || 'all',
          isModerator: Boolean(m.is_moderator),
          createdAt: m.created_at
        }));
        setMessages(mapped);

        // Automated System Message Implant: Ensure Escrow Secured notice exists for active trade
        const hasInitiatedMsg = mapped.some((m: any) =>
          typeof m.message === 'string' &&
          (m.message.includes('PAXONES ESCROW SECURED') || m.message.includes('safely held in Paxones Escrow'))
        );

        if (!hasInitiatedMsg && (tradeStatus === 'active' || tradeStatus === 'pending')) {
          fetch(`/api/trades/${encodeURIComponent(tradeId)}/system-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'TRADE_INITIATED',
              metadata: {
                buyerUsername: isBuyer ? currentProfileUsername : (opponent?.username || 'Buyer'),
                sellerUsername: isBuyer ? (opponent?.username || 'Seller') : currentProfileUsername,
                coinAmount: trade?.crypto_amount || trade?.amount,
                coinSymbol: trade?.crypto || trade?.asset_symbol || 'USDT',
                fiatAmount: trade?.fiat_amount || trade?.fiatAmount,
                fiatCurrency: trade?.fiat_currency || trade?.fiatCurrency,
                paymentMethod: trade?.payment_method || trade?.ad?.payment_method_name || trade?.ad?.payment_method
              }
            })
          }).catch((err) => console.warn('Automated system initiation message dispatch warning:', err));
        }
      }
      setAreMessagesLoading(false);
    };

    fetchMessages();

    const channelTopic = `trade-chat-${tradeId}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: `trade_id=eq.${tradeId}` },
        (payload) => {
          const raw = payload.new as any;
          const formatted: any = {
            id: raw.id,
            tradeId: raw.trade_id,
            senderId: raw.sender_id,
            senderUsername: raw.sender_username,
            message: raw.message,
            mediaUrl: raw.media_url,
            mediaType: raw.media_type,
            visibility: raw.visibility || 'all',
            isModerator: Boolean(raw.is_moderator),
            createdAt: raw.created_at
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === formatted.id)) return prev;
            return [...prev, formatted];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tradeId, supabase, toast]);

  const displayMessages = useMemo(() => {
    if (!messages) return [];
    const allMessages = [...messages];
    allMessages.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0));
    return allMessages;
  }, [messages]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [displayMessages]);

  const hasClaimedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const claimStorageKey = `trade_funds_claimed_${tradeId}_${currentUserId}`;
    const alreadyClaimedInStorage = sessionStorage.getItem(claimStorageKey) === 'true';

    if (
      tradeStatus === 'released' &&
      !hasClaimedRef.current &&
      !alreadyClaimedInStorage &&
      !trade?.claimedByBuyer &&
      !trade?.claimed_by_buyer &&
      isBuyer
    ) {
      hasClaimedRef.current = true;
      sessionStorage.setItem(claimStorageKey, 'true');
      const claim = async () => {
        try {
          await claimFundsForTrade(supabase, trade, currentUserId);
        } catch (error: any) {
          console.error('Auto-claiming funds failed:', error);
        }
      };
      claim();
    }
  }, [tradeStatus, trade, isBuyer, currentUserId, supabase, tradeId]);

  const handleSendMessage = async (
    e?: React.FormEvent,
    mediaUrl?: string,
    mediaType?: 'image' | 'video' | 'document' | 'none',
    visibility: 'all' | 'moderator_only' = 'all'
  ) => {
    if (e) e.preventDefault();
    if (!newMessage.trim() && !mediaUrl) return;

    if (newMessage.length > 1000) {
      toast({
        variant: 'destructive',
        title: 'Message Too Long',
        description: 'Messages cannot exceed 1000 characters.'
      });
      return;
    }

    // Security Check: Off-platform communication detection
    const offPlatformCheck = checkOffPlatformMessage(newMessage);
    if (offPlatformCheck.isBlocked) {
      toast({
        variant: 'destructive',
        title: 'Message Blocked by Security Protocol',
        description: offPlatformCheck.reason || 'Off-platform communication is strictly prohibited.'
      });

      // Insert official Paxones System Message warning to chat
      await insertPaxonesSystemMessage(supabase, {
        tradeId,
        type: 'MESSAGE_BLOCKED'
      });

      setNewMessage('');
      return;
    }

    const messageToSend = newMessage.trim();
    setNewMessage('');

    try {
      const { error } = await supabase.from('trade_messages').insert([
        {
          trade_id: tradeId,
          sender_id: currentUserId,
          sender_username: opponent?.username || opponent?.userId || 'Trader',
          message: messageToSend,
          is_moderator: isAdmin,
          media_url: mediaUrl || null,
          media_type: mediaType || 'none',
          visibility,
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      if (mediaUrl && (tradeStatus === 'active' || tradeStatus === 'pending')) {
        await addReceiptToTrade(tradeId, mediaUrl);
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Send Failed', description: error.message });
    }
  };

  const processAndUploadFile = async (fileToUpload: File, chosenVisibility: 'all' | 'moderator_only') => {
    setIsUploading(true);
    try {
      // 1. Image compression
      let finalFile = fileToUpload;
      if (fileToUpload.type.startsWith('image/')) {
        finalFile = await compressImage(fileToUpload);
      }

      // 2. Video 30MB validation
      if (fileToUpload.type.startsWith('video/') && fileToUpload.size > 30 * 1024 * 1024) {
        throw new Error('Video exceeds maximum 30 MB size limit.');
      }

      // 3. Upload to Backblaze B2 via API endpoint
      const formData = new FormData();
      formData.append('file', finalFile);
      formData.append('tradeId', tradeId);
      formData.append('senderId', currentUserId);
      formData.append('visibility', chosenVisibility);

      const res = await fetch('/api/upload/trade-media', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to upload media');
      }

      await handleSendMessage(undefined, data.url, data.mediaType, chosenVisibility);
      toast({
        title: 'Media Uploaded',
        description: chosenVisibility === 'moderator_only' ? 'Uploaded (Moderator Only)' : 'Media uploaded successfully'
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: err.message });
    } finally {
      setIsUploading(false);
      setPendingUploadFile(null);
      setIsPrivacyModalOpen(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if in dispute mode
    if (isDisputed) {
      setPendingUploadFile(file);
      setIsPrivacyModalOpen(true);
    } else {
      await processAndUploadFile(file, 'all');
    }
  };

  const opponentUsername = opponent?.username || opponent?.userId || opponent?.user_id || 'Trader';
  const opponentRoleLabel = isBuyer ? 'Seller' : 'Buyer';
  const opponentPhoto = opponent?.photoURL || opponent?.photo_url;
  const positiveFeedback = Number(opponent?.positiveFeedback ?? opponent?.positive_feedback ?? 0);
  const negativeFeedback = Number(opponent?.negativeFeedback ?? opponent?.negative_feedback ?? 0);

  const opponentPresence = usePresenceStatus(opponent, 15000);
  const opponentLastActive = resolveUserLastSeen(opponent);
  
  let activity = {
    text: opponentPresence.label,
    dotClass: opponentPresence.isOnline ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-gray-400',
    textClass: opponentPresence.isOnline ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-muted-foreground'
  };

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none bg-card text-card-foreground">
      <CardHeader className="space-y-2.5 sm:space-y-3 border-b border-border/60 p-2.5 sm:p-4">
        <div className="flex justify-between items-center gap-2">
          {/* Left: Opponent Avatar & Details */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <Link href={`/users/${opponentUsername}`} className="shrink-0">
              <Avatar className="h-8 w-8 sm:h-10 sm:w-10 border border-primary/20">
                <AvatarImage src={opponentPhoto} alt={opponentUsername} />
                <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs sm:text-sm">
                  <DefaultAvatar />
                </AvatarFallback>
              </Avatar>
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                <Link
                  href={`/users/${opponentUsername}`}
                  className="font-bold text-xs sm:text-sm text-foreground hover:underline truncate max-w-[110px] sm:max-w-[160px]"
                >
                  @{opponentUsername}
                </Link>
                <MerchantBadge tier={opponent?.merchant_tier || (opponent as any)?.merchantTier} size="sm" />
                <span className="text-[10px] sm:text-[11px] font-semibold px-1 sm:px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                  {opponentRoleLabel}
                </span>
                {opponent?.country && (
                  <span className="shrink-0 scale-90 sm:scale-100 origin-left">
                    <FlagIcon countryCode={opponent.country} />
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onInfoClick}
                  className="h-5 w-5 sm:h-6 sm:w-6 text-primary hover:text-primary shrink-0 p-0"
                  title="Trader Information"
                >
                  <InfoIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5">
                <div className={cn('h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full shrink-0', activity.dotClass)} />
                <p className={cn('text-[11px] sm:text-xs font-medium truncate', activity.textClass)}>{activity.text}</p>
              </div>
            </div>
          </div>

          {/* Right: Feedback & Timer */}
          <div className="text-right shrink-0">
            <div className="flex items-center gap-2 sm:gap-3 text-[11px] sm:text-xs justify-end font-semibold">
              <div className="flex items-center gap-0.5 sm:gap-1 text-emerald-600 dark:text-emerald-400">
                <ThumbsUp className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="font-[Arial,Helvetica,sans-serif]">{liveOpponentFeedback.positive}</span>
              </div>
              <div className="flex items-center gap-0.5 sm:gap-1 text-destructive">
                <ThumbsDown className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="font-[Arial,Helvetica,sans-serif]">{liveOpponentFeedback.negative}</span>
              </div>
            </div>
            
            {/* Dual Timer Badges: Reverse Countdown + Active Stopwatch via TradeChatTimer */}
            <div className="mt-0.5 sm:mt-1 scale-90 sm:scale-100 origin-right">
              <TradeChatTimer
                createdAt={trade?.createdAt || trade?.created_at || new Date().toISOString()}
                status={effectiveTradeStatus.toUpperCase()}
                durationSeconds={trade?.duration_seconds}
                paymentWindowMinutes={timeLimitMinutes}
              />
            </div>
          </div>
        </div>

        <TradeSummaryBar trade={trade} currentUserRole={isBuyer ? 'buy' : 'sell'} />

        {/* Official Pinned Security Banner */}
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-900 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="leading-tight">
            <strong>Paxones Security:</strong> Never share passwords, 2FA tokens, or seed phrases. All trades must stay within Paxones escrow.
          </p>
        </div>
      </CardHeader>

      {/* Independent Scrollable Chat Area */}
      <CardContent className="flex-1 overflow-hidden p-4 min-h-0">
        <ScrollArea className="h-full pr-3" ref={scrollAreaRef}>
          <div className="space-y-4">
            <TradeInstructions trade={trade} isBuyer={isBuyer} opponentUsername={opponentUsername} />

            {sellerTerms && (
              <div className="rounded-xl border border-border/80 bg-muted/40 p-3 text-xs">
                <p className="font-bold flex items-center gap-1.5 mb-1 text-foreground">
                  <InfoIcon className="h-3.5 w-3.5 text-primary" />
                  Seller&apos;s Terms &amp; Conditions
                </p>
                <p className="whitespace-pre-wrap leading-relaxed opacity-90">{sellerTerms}</p>
              </div>
            )}

            {areMessagesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-14 w-3/4" />
                <Skeleton className="h-14 w-3/4 ml-auto" />
              </div>
            ) : (
              <div className="space-y-3">
                {displayMessages.map((msg) => {
                  const isSystemMsg =
                    msg.senderId === 'system' ||
                    msg.senderId === '00000000-0000-0000-0000-000000000000' ||
                    msg.senderUsername === 'Paxones System' ||
                    msg.senderUsername === 'System' ||
                    Boolean(msg.isModerator && msg.senderUsername?.toLowerCase().includes('system')) ||
                    Boolean(msg.isSystemMessage) ||
                    Boolean(msg.is_system_message) ||
                    (typeof msg.message === 'string' && (
                      msg.message.includes('PAXONES ESCROW SECURED') ||
                      msg.message.includes('TRADE EXPIRED') ||
                      msg.message.includes('Paxones Security Reminder') ||
                      msg.message.includes('Message blocked:') ||
                      (msg.message.includes('sold') && msg.message.includes('successfully to @')) ||
                      msg.message.includes('Trade is now in dispute.') ||
                      msg.message.includes('Trade cancelled.')
                    ));

                  if (isSystemMsg) {
                    return (
                      <PaxonesSystemMessageBubble
                        key={msg.id}
                        msg={msg}
                        onOpenExternalLink={(url) => setSelectedExternalUrl(url)}
                        timezone={timezone}
                      />
                    );
                  }

                  const isCurrentUser = msg.senderId === currentUserId;
                  const isModeratorOnly = msg.visibility === 'moderator_only';
                  const canViewModeratorFile = isAdmin || isCurrentUser;

                  let senderDisplayName = isCurrentUser ? `You (${userRoleLabel})` : `@${opponentUsername} (${opponentRoleLabel})`;
                  if (msg.isModerator) senderDisplayName = 'Paxones Moderator';

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isCurrentUser ? 'justify-end' : 'justify-start')}>
                      {!isCurrentUser && (
                        <Avatar className="h-7 w-7 shrink-0 border border-border">
                          {msg.isModerator ? (
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-bold">MOD</AvatarFallback>
                          ) : (
                            <>
                              <AvatarImage src={opponentPhoto} />
                              <AvatarFallback className="text-[10px]">{opponentUsername?.substring(0, 2)}</AvatarFallback>
                            </>
                          )}
                        </Avatar>
                      )}

                      <div
                        className={cn(
                          'max-w-[80%] rounded-2xl p-3 text-xs sm:text-sm flex flex-col gap-1 shadow-2xs',
                          isCurrentUser && !msg.isModerator && 'bg-primary text-primary-foreground rounded-br-xs',
                          !isCurrentUser && !msg.isModerator && 'bg-muted text-foreground rounded-bl-xs',
                          msg.isModerator && 'bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200'
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-bold text-[11px] opacity-90">{senderDisplayName}</p>
                          {isModeratorOnly && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-sm bg-destructive/10 text-destructive border border-destructive/20">
                              <Lock className="h-2.5 w-2.5" /> Moderator Only
                            </span>
                          )}
                        </div>

                        {msg.message && (
                          <FormattedUserMessage
                            content={msg.message}
                            onOpenExternalLink={(url) => setSelectedExternalUrl(url)}
                          />
                        )}

                        {/* Media attachments */}
                        {msg.mediaUrl && (
                          <div className="mt-1">
                            {isModeratorOnly && !canViewModeratorFile ? (
                              <div className="p-2.5 rounded-lg bg-background/50 border border-border/60 text-xs flex items-center gap-2 text-muted-foreground">
                                <Lock className="h-4 w-4 text-destructive" />
                                <span>Private evidence submitted to Moderator</span>
                              </div>
                            ) : msg.mediaType === 'image' ? (
                              <button
                                type="button"
                                onClick={() => openAttachmentPreview(msg.mediaUrl, 'image')}
                                className="block mt-1 text-left cursor-pointer group"
                              >
                                <img
                                  src={getMediaDisplayUrl(msg.mediaUrl)}
                                  alt="Media Attachment"
                                  className="rounded-lg object-cover max-h-56 max-w-full border border-border/40 group-hover:opacity-90 transition-opacity"
                                />
                              </button>
                            ) : msg.mediaType === 'video' ? (
                              <div className="mt-1">
                                <video controls className="max-h-56 rounded-lg w-full" src={getMediaDisplayUrl(msg.mediaUrl)} />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openAttachmentPreview(msg.mediaUrl, msg.mediaType || 'document')}
                                className="inline-flex items-center gap-2 p-2 rounded-lg bg-background/40 hover:bg-background/80 border text-xs font-semibold underline mt-1 cursor-pointer"
                              >
                                <FileText className="h-4 w-4 text-primary" />
                                <span>View Attachment ({msg.mediaUrl.split('.').pop()?.toUpperCase() || 'FILE'})</span>
                              </button>
                            )}
                          </div>
                        )}

                        <p className="text-[10px] font-mono opacity-70 text-right w-full mt-0.5" title={formatUtcDateTime(msg.createdAt)}>
                          {formatUserChatTime(msg.createdAt, timezone)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {/* Interactive Post-Trade Completion Card rendered inside chat upon release/completion */}
                {(tradeStatus === 'released' || tradeStatus === 'completed') && (
                  <PostTradeCompletionCard
                    trade={trade}
                    isBuyer={isBuyer}
                    opponentUsername={opponentUsername}
                    onOpenExternalLink={(url) => setSelectedExternalUrl(url)}
                  />
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>

      <CardFooter className="border-t border-border/60 p-3 flex flex-col gap-2">
        <form onSubmit={handleSendMessage} className="w-full space-y-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileSelect}
            accept="image/*,video/*,application/pdf,.doc,.docx"
          />
          <div className="flex w-full items-end space-x-2">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="text-muted-foreground hover:text-foreground shrink-0 mb-1"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </Button>
            <div className="relative flex-1">
              <textarea
                maxLength={1000}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isUploading && newMessage.trim()) {
                      handleSendMessage(e);
                    }
                  }
                }}
                placeholder="Type a message..."
                disabled={isUploading}
                rows={2}
                className="w-full resize-none rounded-xl border border-input bg-background/50 px-3 py-2 text-xs sm:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus:bg-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={isUploading || !newMessage.trim()}
              className="shrink-0 font-bold mb-1"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center justify-between px-1 text-xs">
            <span className="hidden sm:inline-block text-[11px] text-muted-foreground">
              Press <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Enter ↵</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Shift+Enter</kbd> for new line
            </span>
            <span className="text-xs text-slate-500 font-mono ml-auto">
              {newMessage.length}/1000
            </span>
          </div>
        </form>
      </CardFooter>

      {/* External Link & Phishing Warning Modal */}
      <Dialog open={Boolean(selectedExternalUrl)} onOpenChange={(open) => !open && setSelectedExternalUrl(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold text-destructive">
              <ShieldAlert className="h-5 w-5 text-destructive" />
              Security Warning: External Link
            </DialogTitle>
            <DialogDescription className="text-xs text-foreground/90 space-y-2 pt-1">
              <p className="font-semibold text-destructive">
                Do not open links unless you have verified that they are safe and belong to the intended service. Links may contain phishing or malicious content.
              </p>
              <p>
                <strong>Never enter your Paxones password, 2FA code, private keys, or other sensitive credentials</strong> after following a link from another user.
              </p>
            </DialogDescription>
          </DialogHeader>

          {selectedExternalUrl && (
            <div className="p-3 rounded-lg bg-muted/60 border border-border text-xs break-all font-mono">
              <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">Target Destination</span>
              {selectedExternalUrl}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" size="sm" onClick={() => setSelectedExternalUrl(null)}>
              Cancel (Stay Safe)
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (selectedExternalUrl) {
                  window.open(selectedExternalUrl, '_blank', 'noopener,noreferrer');
                }
                setSelectedExternalUrl(null);
              }}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Open External Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute Media Privacy Selection Modal */}
      <Dialog open={isPrivacyModalOpen} onOpenChange={setIsPrivacyModalOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Dispute Evidence Privacy
            </DialogTitle>
            <DialogDescription className="text-xs">
              This trade is currently in dispute. Who should be allowed to view this attachment?
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={disputeVisibility}
            onValueChange={(val: any) => setDisputeVisibility(val)}
            className="space-y-2.5 py-2"
          >
            <div className="flex items-center space-x-3 p-3 rounded-xl border border-border bg-muted/20 cursor-pointer">
              <RadioGroupItem value="all" id="opt-all" />
              <Label htmlFor="opt-all" className="cursor-pointer text-xs font-semibold">
                <div className="text-foreground">Moderator and Counterparty</div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  Visible to both you, your trading partner, and the Paxones escrow mediator.
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-xl border border-destructive/30 bg-destructive/5 cursor-pointer">
              <RadioGroupItem value="moderator_only" id="opt-mod" />
              <Label htmlFor="opt-mod" className="cursor-pointer text-xs font-semibold">
                <div className="text-destructive flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Only Moderator (Private Evidence)
                </div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  Your counterparty cannot view or open this file. Only the mediator can review it.
                </div>
              </Label>
            </div>
          </RadioGroup>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsPrivacyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingUploadFile) {
                  processAndUploadFile(pendingUploadFile, disputeVisibility);
                }
              }}
              disabled={isUploading}
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Upload Media
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* In-App Media Lightbox & Document Preview Dialog */}
      <Dialog open={!!previewMedia} onOpenChange={(open) => !open && setPreviewMedia(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] bg-card border-border p-4 flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-sm font-bold">
              <span className="flex items-center gap-2 truncate">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{previewMedia?.filename || 'Attachment Preview'}</span>
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Direct in-app attachment view.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-[350px] max-h-[65vh] flex flex-col items-center justify-center p-2 bg-muted/20 rounded-xl border border-border/50 overflow-auto">
            {previewMedia?.type === 'image' ? (
              <img
                src={previewMedia.url}
                alt="Attachment Preview"
                className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-xs"
              />
            ) : previewMedia?.type === 'video' ? (
              <video controls autoPlay className="max-h-[60vh] max-w-full rounded-lg" src={previewMedia.url} />
            ) : previewMedia?.isPdf ? (
              <iframe
                src={previewMedia.url}
                title="PDF Attachment Viewer"
                className="w-full h-[60vh] rounded-lg border-0 bg-white"
              />
            ) : previewMedia?.isCsv ? (
              isLoadingPreviewContent ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-medium">Loading spreadsheet data...</span>
                </div>
              ) : csvContent ? (
                <div className="w-full h-[60vh] overflow-auto bg-background rounded-lg p-2 font-mono text-xs">
                  <table className="w-full border-collapse border border-border/60 text-left">
                    <tbody>
                      {csvContent.split('\n').filter(Boolean).map((row, rIdx) => {
                        const cols = row.split(',');
                        return (
                          <tr key={rIdx} className={rIdx === 0 ? 'bg-muted font-bold' : 'hover:bg-muted/40'}>
                            {cols.map((c, cIdx) => (
                              <td key={cIdx} className="border border-border/60 px-2.5 py-1.5 whitespace-nowrap">
                                {c.trim()}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Unable to render CSV inline.</p>
              )
            ) : previewMedia?.isText ? (
              isLoadingPreviewContent ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-medium">Loading text content...</span>
                </div>
              ) : (
                <pre className="w-full h-[60vh] overflow-auto bg-background rounded-lg p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                  {textContent || 'Empty document.'}
                </pre>
              )
            ) : (
              <div className="p-8 text-center space-y-3">
                <FileText className="h-16 w-16 text-primary mx-auto" />
                <p className="text-sm font-semibold text-foreground">
                  {previewMedia?.filename || 'Attachment File'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Click the download button below to save the file to your device.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              asChild
            >
              <a
                href={previewMedia?.url ? (previewMedia.url.includes('?') ? `${previewMedia.url}&download=true` : `${previewMedia.url}?download=true`) : '#'}
                download={previewMedia?.filename || true}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs font-bold"
              >
                <Download className="h-3.5 w-3.5" />
                Download File
              </a>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPreviewMedia(null)}
              className="text-xs font-bold"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export { TradeChat as TradeChatSupabase };
export default TradeChat;
