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
import {
  formatLocalizedTradeSystemMessage,
  getTradeSystemMessageBadge,
  getTradeSystemMessageTitle,
} from '@/lib/trade-system-message-locales';
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
import { useI18n } from '@/context/i18n-context';

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
  const { t, language } = useI18n();
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }
  
  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || 'USD';

  const coinAmount = rawCrypto > 0 ? (rawCrypto < 0.01 ? rawCrypto.toFixed(6) : rawCrypto.toFixed(2)) : '0.00';
  const fiatAmount = rawFiat > 0 ? rawFiat.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';

  const partnerName = opponentUsername ? `@${opponentUsername}` : (isBuyer ? `@${t('tradeDetailsPage.seller')}` : `@${t('tradeDetailsPage.buyer')}`);

  const buyerInstructions = [
    t('tradeChat.buyerInstruction1').replace('{partner}', partnerName),
    t('tradeChat.buyerInstruction2'),
    t('tradeChat.buyerInstruction3'),
    t('tradeChat.buyerInstruction4').replace('{partner}', partnerName),
    t('tradeChat.buyerInstruction5'),
  ];
  const sellerInstructions = [
    t('tradeChat.sellerInstruction1'),
    t('tradeChat.sellerInstruction2').replace('{partner}', partnerName),
    t('tradeChat.sellerInstruction3'),
    t('tradeChat.sellerInstruction4'),
    t('tradeChat.sellerInstruction5'),
  ];

  const instructions = isBuyer ? buyerInstructions : sellerInstructions;

  return (
    <div className="p-4 bg-muted/50 dark:bg-slate-800/80 rounded-2xl border border-border/80 dark:border-slate-800 mb-4 text-sm space-y-2.5">
      <p className="font-semibold text-foreground">
        {isBuyer ? t('tradeChat.youAreBuying') + ' ' : t('tradeChat.youAreSelling') + ' '}
        <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{coinAmount} {coinSymbol}</strong> {t('tradeChat.for')}{' '}
        <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{fiatAmount} {fiatCurrency}</strong>.
      </p>
      <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
        <li>{t('tradeChat.escrowDepositNotice').replace('{amount}', coinAmount).replace('{coin}', coinSymbol)}</li>
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
  const { t, language } = useI18n();
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }
  
  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || 'USD';

  const coinAmount = rawCrypto > 0 ? (rawCrypto < 0.01 ? rawCrypto.toFixed(6) : rawCrypto.toFixed(2)) : '0.00';
  const fiatAmount = rawFiat > 0 ? rawFiat.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00';
  const priceFormatted = rawRate > 0 
    ? rawRate.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : (rawFiat > 0 && rawCrypto > 0 ? (rawFiat / rawCrypto).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00');

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-background p-4 sm:p-5 my-3 shadow-md text-foreground">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="h-9 w-9 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-bold text-sm sm:text-base text-foreground">{t('tradeChat.completionTitle')}</h3>
          <p className="text-xs text-muted-foreground">
            {isBuyer
              ? t('tradeChat.completionBuyerMessage').replace('{amount}', coinAmount).replace('{coin}', coinSymbol)
              : t('tradeChat.completionSellerMessage').replace('{amount}', coinAmount).replace('{coin}', coinSymbol).replace('{username}', opponentUsername)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 my-3 p-3 rounded-xl bg-background/60 border border-border/60 text-xs">
        <div>
          <span className="text-muted-foreground text-[11px] block">{t('tradeChat.postTradeAmountTransferred')}</span>
          <span className="font-bold text-foreground font-mono">{coinAmount} {coinSymbol}</span>
        </div>
        <div>
          <span className="text-muted-foreground text-[11px] block">{t('tradeChat.postTradeTotalFiat')}</span>
          <span className="font-bold text-foreground font-mono">{fiatAmount} {fiatCurrency}</span>
        </div>
        <div className="col-span-2 pt-1.5 border-t border-border/40 flex justify-between text-[11px]">
          <span className="text-muted-foreground">{t('tradeChat.postTradeExchangeRate')}</span>
          <span className="font-semibold text-foreground">1 {coinSymbol} = {priceFormatted} {fiatCurrency}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Button
          size="sm"
          className="w-full bg-[#00b67a] hover:bg-[#009b67] text-white font-bold text-xs gap-1.5 shadow-sm"
          onClick={() => onOpenExternalLink('https://www.trustpilot.com/review/wayones.com')}
        >
          <span>★ {t('tradeChat.rateUsTrustpilot')}</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Enhanced System Message bubble with official Wayones badge, color accents,
 * and high-contrast readable styling.
 */
function WayonesSystemMessageBubble({
  msg,
  onOpenExternalLink,
  timezone,
  language,
}: {
  msg: any;
  onOpenExternalLink: (url: string) => void;
  timezone?: string;
  language: string;
}) {
  const eventType = typeof msg.type === 'string'
    ? msg.type
    : typeof msg.metadata?.type === 'string'
      ? msg.metadata.type
      : undefined;
  const localizedMessage = formatLocalizedTradeSystemMessage(
    eventType,
    msg.metadata,
    language,
    typeof msg.message === 'string' ? msg.message : '',
  );
  const text = localizedMessage || msg.message || '';
  const timestamp = msg.createdAt || msg.created_at;
  const timeString = formatUserDateTimeArial(timestamp, timezone) || '';

  // Determine system message category
  const normalizedEventType = (eventType || '').toUpperCase();
  const isInitiated = ['TRADE_INITIATED', 'TRADE_STARTED', 'ESCROW_LOCKED'].includes(normalizedEventType) ||
    text.includes('Wayones ESCROW SECURED') || text.includes('safely held in Wayones Escrow') || text.includes('Escrow Secured');
  const isExpired = normalizedEventType === 'TRADE_EXPIRED' || text.toLowerCase().includes('expired') || text.toLowerCase().includes('coin is no longer held');
  const isCompleted = !isExpired && (['TRADE_COMPLETED', 'TRADE_RELEASED'].includes(normalizedEventType) ||
    (text.includes('sold') && text.includes('successfully')) || (text.includes('bought') && text.includes('successfully')) || text.includes('Trade Completed') || text.includes('released'));
  const isCancelled = normalizedEventType === 'TRADE_CANCELLED' || (!isExpired && (text.toLowerCase().includes('trade cancelled') || text.toLowerCase().includes('cancelled.')));
  const isDispute = normalizedEventType === 'TRADE_DISPUTED' || text.includes('in dispute') || text.includes('DISPUTE') || text.includes('Dispute Assistant') || text.includes('Dispute Notice');
  const isBlockedUser = normalizedEventType === 'USER_BLOCKED' || text.includes('blocked @') || text.includes('User Blocked');
  const isPositiveFeedback = normalizedEventType === 'POSITIVE_FEEDBACK' || text.includes('positive feedback');
  const isNegativeFeedback = normalizedEventType === 'NEGATIVE_FEEDBACK' || text.includes('negative feedback');
  const isIssueReported = normalizedEventType === 'ISSUE_REPORTED' || text.includes('reported an issue') || text.includes('Issue Reported');
  const isMessageBlocked = normalizedEventType === 'MESSAGE_BLOCKED' || text.includes('Message blocked:') || text.includes('off-platform communication');
  const isPaid = normalizedEventType === 'MARKED_PAID' || text.includes('confirmed payment') || text.includes('Marked as Paid') || text.includes('marked as paid');
  const isSecurityReminder = normalizedEventType === 'SECURITY_REMINDER' || text.includes('Wayones Security Reminder');
  const isModeratorJoined = normalizedEventType === 'MODERATOR_JOINED' || text.includes('Wayones Moderator joined the trade chat') || text.includes('Wayones Moderator joined');

  let title = 'Wayones System';
  let badgeClass = 'bg-primary/10 text-primary border-primary/20';
  let containerClass = 'bg-muted/60 border-border/80 text-foreground';
  let IconComponent = ShieldCheck;

  if (isModeratorJoined) {
    title = 'Wayones Moderator';
    badgeClass = 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/40 font-bold';
    containerClass = 'bg-purple-500/10 border-purple-500/30 text-purple-950 dark:text-purple-100 font-semibold';
    IconComponent = ShieldAlert;
  } else if (isInitiated) {
    title = 'Trade Initiated';
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
    title = 'Wayones Security Reminder';
    badgeClass = 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';
    containerClass = 'bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-100';
    IconComponent = ShieldCheck;
  }

  // Event metadata is authoritative for new system events. Retain text-based titles
  // for legacy rows that predate the dedicated event type/metadata columns.
  const localizedEventTitle = getTradeSystemMessageTitle(eventType, language);
  if (localizedEventTitle) title = localizedEventTitle;

  // Format message text: highlight @mentions and lines
  const lines = text.split('\n');

  return (
    <div className={cn('rounded-xl border p-3.5 my-2.5 text-xs transition-all shadow-xs', containerClass)}>
      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-current/15">
        <div className="flex items-center gap-2 font-bold tracking-tight">
          <div className="relative h-6 w-6 rounded-full overflow-hidden shrink-0 border border-current/25 bg-background/80 flex items-center justify-center p-0.5 shadow-2xs">
            <Image
              src="/logo-mobile.webp"
              alt="Wayones"
              width={24}
              height={24}
              className="h-full w-full object-contain"
            />
          </div>
          <IconComponent className="h-4 w-4 shrink-0" />
          <span>{title}</span>
        </div>
        <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase border', badgeClass)}>
          {getTradeSystemMessageBadge(language)}
        </span>
      </div>

      <div
        dir={language === 'ar' ? 'rtl' : 'ltr'}
        className={cn(
          'space-y-1.5 text-xs leading-relaxed whitespace-pre-wrap font-sans',
          language === 'ar' ? 'text-right' : 'text-left'
        )}
      >
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
  const { t } = useI18n();
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
              title={t('tradeChat.externalLinkTooltip')}
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
  const { t, language } = useI18n();
  const isBuyer = currentUserRole === 'buy';
  const roleText = isBuyer ? t('tradeDetailsPage.buying') : t('tradeDetailsPage.selling');

  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.asset ?? 'USDT';
  const rawCrypto = getPositiveVal(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount);
  const rawRate = getPositiveVal(trade?.rate, trade?.price, trade?.unit_price);
  
  let rawFiat = getPositiveVal(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat);
  if (rawFiat <= 0 && rawCrypto > 0 && rawRate > 0) {
    rawFiat = rawCrypto * rawRate;
  }

  const coinAmount = formatCryptoAmount(rawCrypto, coinSymbol);
  const fiatAmount = rawFiat.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
      <span className="font-medium opacity-90">{t('tradeChat.for')}</span>
      <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">
        {fiatAmount}
      </span>
      <span className="font-sans font-bold">{fiatCurrency}</span>
    </div>
  );
};

const LEGACY_BRAND_TOKEN = String.fromCharCode(80, 97, 120, 111, 110, 101, 115);

function normalizeLegacyBrandDisplay(value: unknown): string {
  return String(value ?? '').replace(new RegExp(LEGACY_BRAND_TOKEN, 'gi'), 'Wayones');
}

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
  const { t, language } = useI18n();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [areMessagesLoading, setAreMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentProfileUsername, setCurrentProfileUsername] = useState<string>('Trader');

  useEffect(() => {
    if (!currentUserId) return;
    supabase.from('public_profiles').select('username').eq('id', currentUserId).maybeSingle().then(({ data }) => {
      if (data?.username) setCurrentProfileUsername(data.username);
    });
  }, [currentUserId, supabase]);

  // External link security modal state (only for typed chat web links)
  const [selectedExternalUrl, setSelectedExternalUrl] = useState<string | null>(null);

  // Oversized file guidance modal state (Google Drive / Dropbox instructions)
  const [isOversizedModalOpen, setIsOversizedModalOpen] = useState(false);
  const [oversizedFileInfo, setOversizedFileInfo] = useState<{ name: string; size: string; type: string } | null>(null);

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
    if (t.paid_at || t.marked_paid_at || t.escrow_status === 'PAID' || ['paid', 'buyer_marked_paid', 'payment_sent'].includes(st)) {
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
  const userRoleLabel = isBuyer ? t('tradeChat.roleBuyer') : t('tradeChat.roleSeller');

  // The canonical database status trigger records duration_seconds atomically
  // when escrow enters a completed/released state. Do not write trade rows from
  // the browser; direct authenticated DML is intentionally disabled.

  // Fetch initial messages & subscribe to Realtime
  useEffect(() => {
    if (!tradeId) return;

    let systemEventsAvailable = false;
    const loadSystemEvents = async () => {
      try {
        const response = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/system-message`, { cache: 'no-store' });
        const result = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(result?.messages)) return [];
        systemEventsAvailable = true;
        return result.messages.map((item: any) => ({
          id: item.id,
          tradeId: item.trade_id,
          senderId: item.sender_id || 'system',
          senderUsername: normalizeLegacyBrandDisplay(item.sender_username || 'Wayones System'),
          type: item.type || item.metadata?.type,
          metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : null,
          message: normalizeLegacyBrandDisplay(item.message),
          mediaUrl: null,
          mediaType: null,
          visibility: 'all',
          isModerator: true,
          isSystemMessage: true,
          createdAt: item.created_at,
        }));
      } catch {
        return [];
      }
    };

    const mergeSystemEvents = (current: any[], events: any[]) => {
      const merged = new Map<string, any>(current.map((item) => [String(item.id), item]));
      for (const event of events) merged.set(String(event.id), event);
      return Array.from(merged.values()).sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''));
    };

    const fetchMessages = async () => {
      setAreMessagesLoading(true);
      const { data, error } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error) {
        toast({ variant: 'destructive', title: t('tradeChat.messageErrorTitle'), description: error.message });
      } else {
        // Do not render moderator-only evidence to the counterparty, including
        // rows returned by direct Supabase reads. Server/API and RLS checks are
        // still required; this is a defense-in-depth client filter.
        const visibleRows = (data || []).filter((m: any) =>
          m.visibility !== 'moderator_only' || isAdmin || m.sender_id === currentUserId
        );
        const mapped = visibleRows.map((m: any) => ({
          id: m.id,
          tradeId: m.trade_id,
          senderId: m.sender_id,
          senderUsername: normalizeLegacyBrandDisplay(m.sender_username),
          message: normalizeLegacyBrandDisplay(m.message),
          mediaUrl: m.media_url,
          mediaType: m.media_type,
          visibility: m.visibility || 'all',
          isModerator: Boolean(m.is_moderator),
          createdAt: m.created_at
        }));
        const systemEvents = await loadSystemEvents();
        const mergedMessages = mergeSystemEvents(mapped, systemEvents);
        setMessages(mergedMessages);

        // Ensure the Escrow Secured instruction exists for active trades without creating a Realtime message.
        const hasInitiatedMsg = mergedMessages.some((m: any) =>
          typeof m.message === 'string' &&
          (m.message.includes('Wayones ESCROW SECURED') || m.message.includes('safely held in Wayones Escrow') || m.message.includes('TRADE INITIATED'))
        );

        if (!hasInitiatedMsg && (tradeStatus === 'active' || tradeStatus === 'pending')) {
          // Resolve usernames with high accuracy
          let resolvedBuyer = trade?.buyer_username || (isBuyer ? (currentProfileUsername !== 'Trader' ? currentProfileUsername : '') : (opponent?.username || ''));
          let resolvedSeller = trade?.seller_username || (isBuyer ? (opponent?.username || '') : (currentProfileUsername !== 'Trader' ? currentProfileUsername : ''));

          if (!resolvedBuyer && currentUserId) {
            try {
              const { data: prof } = await supabase.from('public_profiles').select('username').eq('id', trade?.buyer_id || (isBuyer ? currentUserId : opponent?.id)).maybeSingle();
              if (prof?.username) resolvedBuyer = prof.username;
            } catch {}
          }
          if (!resolvedSeller && currentUserId) {
            try {
              const { data: prof } = await supabase.from('public_profiles').select('username').eq('id', trade?.seller_id || (!isBuyer ? currentUserId : opponent?.id)).maybeSingle();
              if (prof?.username) resolvedSeller = prof.username;
            } catch {}
          }

          try {
            const response = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/system-message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'TRADE_INITIATED',
                metadata: {
                  buyerUsername: resolvedBuyer || (isBuyer ? currentProfileUsername : opponent?.username) || 'Trader',
                  sellerUsername: resolvedSeller || (!isBuyer ? currentProfileUsername : opponent?.username) || 'Trader',
                  coinAmount: trade?.crypto_amount || trade?.amount,
                  coinSymbol: trade?.crypto || trade?.asset_symbol || 'USDT',
                  fiatAmount: trade?.fiat_amount || trade?.fiatAmount,
                  fiatCurrency: trade?.fiat_currency || trade?.fiatCurrency,
                  paymentMethod: trade?.payment_method || trade?.ad?.payment_method_name || trade?.ad?.payment_method
                }
              })
            });
            if (response.ok) {
              const refreshedSystemEvents = await loadSystemEvents();
              setMessages((current) => mergeSystemEvents(current, refreshedSystemEvents));
            }
          } catch {
            console.warn('Automated system initiation event dispatch failed.');
          }
        }
      }
      setAreMessagesLoading(false);
    };

    fetchMessages();
    const systemEventPoll = window.setInterval(() => {
      if (!systemEventsAvailable) return;
      void loadSystemEvents().then((events) => {
        if (events.length > 0) setMessages((current) => mergeSystemEvents(current, events));
      });
    }, 15000);

    // Historical chats remain readable after a trade closes, but no Realtime channel is
    // needed once the trade is terminal. System events are polled separately, not broadcast.
    if (isTradeStopped) return () => window.clearInterval(systemEventPoll);

    const channelTopic = `trade-chat-${tradeId}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: `trade_id=eq.${tradeId}` },
        (payload) => {
          const raw = payload.new as any;
          // Realtime bypasses the initial fetch mapping, so enforce the same
          // moderator-only display rule before adding any inserted row.
          if (
            raw.visibility === 'moderator_only' &&
            !isAdmin &&
            raw.sender_id !== currentUserId
          ) {
            return;
          }
          const formatted: any = {
            id: raw.id,
            tradeId: raw.trade_id,
            senderId: raw.sender_id,
            senderUsername: normalizeLegacyBrandDisplay(raw.sender_username),
            message: normalizeLegacyBrandDisplay(raw.message),
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
      window.clearInterval(systemEventPoll);
      supabase.removeChannel(channel);
    };
  }, [
    tradeId,
    supabase,
    toast,
    isTradeStopped,
    currentProfileUsername,
    currentUserId,
    isBuyer,
    opponent?.id,
    opponent?.username,
    trade?.ad?.payment_method,
    trade?.ad?.payment_method_name,
    trade?.amount,
    trade?.asset_symbol,
    trade?.buyer_id,
    trade?.buyer_username,
    trade?.crypto,
    trade?.crypto_amount,
    trade?.fiatAmount,
    trade?.fiatCurrency,
    trade?.fiat_amount,
    trade?.fiat_currency,
    trade?.payment_method,
    trade?.seller_id,
    trade?.seller_username,
    tradeStatus,
  ]);

  useEffect(() => {
    if (!tradeId) return;
    const onLocalSystemMessage = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail;
      if (!detail || String(detail.tradeId) !== String(tradeId) || typeof detail.message !== 'string') return;
      setMessages((current) => {
        if (current.some((item) => String(item.id) === String(detail.id))) return current;
        return [...current, {
          ...detail,
          senderUsername: normalizeLegacyBrandDisplay(detail.senderUsername),
          message: normalizeLegacyBrandDisplay(detail.message),
          isModerator: true,
          isSystemMessage: true,
        }];
      });
    };
    window.addEventListener('paxones:trade-system-message', onLocalSystemMessage as EventListener);
    return () => window.removeEventListener('paxones:trade-system-message', onLocalSystemMessage as EventListener);
  }, [tradeId]);

  const displayMessages = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    const allMessages = [...messages];
    allMessages.sort((a, b) => (toDate(a.createdAt)?.getTime() ?? 0) - (toDate(b.createdAt)?.getTime() ?? 0));

    // Deduplicate system messages so each transition/status notice is displayed only once
    const seenSystemKeys = new Set<string>();
    const deduplicated: any[] = [];

    for (const msg of allMessages) {
      const isSystem =
        msg.senderId === 'system' ||
        msg.senderId === '00000000-0000-0000-0000-000000000000' ||
        msg.senderUsername === 'Wayones System' ||
        msg.senderUsername === 'System' ||
        Boolean(msg.isModerator && msg.senderUsername?.toLowerCase().includes('system')) ||
        Boolean(msg.isSystemMessage) ||
        Boolean(msg.is_system_message) ||
        (typeof msg.message === 'string' && (
          msg.message.includes('Wayones ESCROW') ||
          msg.message.includes('TRADE INITIATED') ||
          msg.message.includes('TRADE EXPIRED') ||
          msg.message.includes('PAYMENT TIME EXCEEDED') ||
          msg.message.includes('Wayones Security Reminder') ||
          msg.message.includes('Message blocked:') ||
          (msg.message.includes('sold') && msg.message.includes('successfully to @')) ||
          msg.message.includes('Trade is now in dispute.') ||
          msg.message.includes('Trade cancelled.') ||
          msg.message.includes('positive feedback') ||
          msg.message.includes('negative feedback')
        ));

      if (isSystem && typeof msg.message === 'string') {
        const text = msg.message.trim();
        let sysKey = '';
        if (text.includes('TRADE EXPIRED') || text.includes('PAYMENT TIME EXCEEDED')) sysKey = 'SYS_EXPIRED';
        else if (text.includes('TRADE INITIATED') || text.includes('Wayones ESCROW SECURED') || text.includes('safely held in Wayones Escrow')) sysKey = 'SYS_INITIATED';
        else if (text.includes('Wayones Moderator joined the trade chat') || text.includes('Wayones Moderator joined')) sysKey = 'SYS_MODERATOR_JOINED';
        else if (text.includes('Trade cancelled')) sysKey = 'SYS_CANCELLED';
        else if (text.includes('Trade is now in dispute')) sysKey = 'SYS_DISPUTED';
        else if (text.includes('sold') && text.includes('successfully to @')) sysKey = 'SYS_RELEASED';
        else if (text.includes('has marked the trade as paid')) sysKey = 'SYS_PAID';

        if (sysKey) {
          if (seenSystemKeys.has(sysKey)) {
            // Duplicate detected, omit redundant message from stream
            continue;
          }
          seenSystemKeys.add(sysKey);
        }
      }
      deduplicated.push(msg);
    }

    return deduplicated;
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
        title: t('tradeChat.messageTooLongTitle'),
        description: t('tradeChat.maxMessageLength')
      });
      return;
    }

    // Security Check: Off-platform communication detection
    const offPlatformCheck = checkOffPlatformMessage(newMessage);
    if (offPlatformCheck.isBlocked) {
      toast({
        variant: 'destructive',
        title: t('tradeChat.messageBlockedTitle'),
        description: offPlatformCheck.matchedTerm
          ? t('tradeChat.blockedContactTerm').replace('{term}', String(offPlatformCheck.matchedTerm))
          : t('tradeChat.offPlatformProhibited')
      });

      // Insert official Wayones System Message warning to chat
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
          sender_username: currentProfileUsername || userRoleLabel || 'Trader',
          message: messageToSend,
          is_moderator: isAdmin,
          media_url: mediaUrl || null,
          media_type: mediaType || 'none',
          visibility,
          created_at: new Date().toISOString()
        }
      ]);

      if (error) throw error;

      // The submitted row already stores media_url/media_type. Do not create a
      // second receipt message for the same attachment: it duplicates chat rows
      // and consumes the participant's 100-message quota twice.
      return true;
    } catch (error: any) {
      const errorMessage = String(error?.message || '');
      const errorDetails = String(error?.details || '');
      if (errorDetails.includes('TRADE_CHAT_LIMIT_REACHED') || /100-message chat limit/i.test(errorMessage)) {
        const supportResponse = await fetch(`/api/trades/${encodeURIComponent(String(tradeId || ''))}/chat-limit-support`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Chat limit reached; moderator assistance requested.' }),
        }).catch(() => null);
        const supportResult = supportResponse ? await supportResponse.json().catch(() => ({})) : {};
        const recorded = Boolean(supportResponse?.ok && supportResult.success);
        const emailSent = Boolean(supportResult.emailSent);
        toast({
          variant: recorded ? 'default' : 'destructive',
          title: t('tradeChat.limitReachedTitle'),
          description: recorded && emailSent
            ? t('tradeChat.limitReachedRecordedEmailed').replace('{tradeId}', String(tradeId || 'unknown'))
            : recorded
              ? t('tradeChat.limitReachedRecordedEmailUnknown').replace('{tradeId}', String(tradeId || 'unknown'))
              : t('tradeChat.limitReachedNotRecorded').replace('{tradeId}', String(tradeId || 'unknown')),
        });
        return false;
      }
      toast({ variant: 'destructive', title: t('tradeChat.sendFailedTitle'), description: errorMessage || t('tradeChat.sendFailedDescription') });
      return false;
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

      // All attachment types share the same 32 MiB per-file limit.
      if (fileToUpload.size > 32 * 1024 * 1024) {
        const mediaType = fileToUpload.type.startsWith('video/')
          ? 'Video'
          : fileToUpload.type.startsWith('image/') ? 'Image' : 'Document';
        setOversizedFileInfo({
          name: fileToUpload.name,
          size: (fileToUpload.size / (1024 * 1024)).toFixed(1) + ' MB',
          type: mediaType + ' (maximum limit 32 MB)'
        });
        setIsOversizedModalOpen(true);
        throw new Error(t('tradeChat.fileSizeLimitError'));
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
        const message = data.message || data.error || t('tradeChat.uploadFailedTitle');
        if (data.error === 'TRADE_MEDIA_LIMIT_REACHED' || data.error === 'FILE_SIZE_LIMIT_EXCEEDED' || res.status === 413 || res.status === 429) {
          setOversizedFileInfo({
            name: fileToUpload.name,
            size: (fileToUpload.size / (1024 * 1024)).toFixed(1) + ' MB',
            type: 'Attachment limit reached'
          });
          setIsOversizedModalOpen(true);
        }
        throw new Error(message);
      }

      const messageSent = await handleSendMessage(undefined, data.url, data.mediaType, chosenVisibility);
      if (messageSent !== true) {
        throw new Error(t('tradeChat.fileUploadedNotSaved').replace('{tradeId}', String(tradeId || 'unknown')));
      }
      toast({
        title: t('tradeChat.mediaUploadedTitle'),
        description: chosenVisibility === 'moderator_only' ? t('tradeChat.mediaUploadedModerator') : t('tradeChat.mediaUploadedSuccess')
      });
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('tradeChat.uploadFailedTitle'), description: err.message });
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

    // Direct upload limit must match the server: 32 MiB for every file type.
    const MAX_FILE_SIZE = 32 * 1024 * 1024;
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    const isOversized = file.size > MAX_FILE_SIZE;

    if (isOversized) {
      setOversizedFileInfo({
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB',
        type: isVideo ? 'Video (limit 32 MB)' : isImage ? 'Image (limit 32 MB)' : 'Document (limit 32 MB)'
      });
      setIsOversizedModalOpen(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // Check if in dispute mode
    if (isDisputed) {
      setPendingUploadFile(file);
      setIsPrivacyModalOpen(true);
    } else {
      await processAndUploadFile(file, 'all');
    }
  };

  const opponentUsername = opponent?.username || (opponent?.userId && !opponent.userId.includes('-') ? opponent.userId : t('counterpartyPanel.fallbackTrader'));
  const opponentRoleLabel = isBuyer ? t('tradeChat.roleSeller') : t('tradeChat.roleBuyer');
  const opponentPhoto = opponent?.photoURL || opponent?.photo_url;
  const positiveFeedback = Number(opponent?.positiveFeedback ?? opponent?.positive_feedback ?? 0);
  const negativeFeedback = Number(opponent?.negativeFeedback ?? opponent?.negative_feedback ?? 0);

  const opponentPresence = usePresenceStatus(opponent, 15000);
  const opponentLastActive = resolveUserLastSeen(opponent);
  
  let activity = {
    text: opponentPresence.isOnline
      ? t('tradeChat.presenceOnline')
      : opponentPresence.label === 'Offline'
        ? t('tradeChat.presenceOffline')
        : (() => {
            const match = opponentPresence.label.match(/^Last seen (\d+)(m|h|d) ago$/);
            if (!match) return opponentPresence.label;
            const key = match[2] === 'm' ? 'presenceLastSeenMinutes' : match[2] === 'h' ? 'presenceLastSeenHours' : 'presenceLastSeenDays';
            return t('tradeChat.' + key).replace('{count}', match[1]);
          })(),
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
                  title={t('tradeChat.traderInformation')}
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
            <strong>{t('tradeChat.chatSecurityBannerTitle')}:</strong> {t('tradeChat.chatSecurityBannerText')}
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
                  {t('tradeChat.sellerTermsHeading')}
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
                    msg.senderUsername === 'Wayones System' ||
                    msg.senderUsername === 'System' ||
                    Boolean(msg.isModerator && msg.senderUsername?.toLowerCase().includes('system')) ||
                    Boolean(msg.isSystemMessage) ||
                    Boolean(msg.is_system_message) ||
                    (typeof msg.message === 'string' && (
                      msg.message.includes('Wayones ESCROW SECURED') ||
                      msg.message.includes('TRADE EXPIRED') ||
                      msg.message.includes('Wayones Security Reminder') ||
                      msg.message.includes('Message blocked:') ||
                      (msg.message.includes('sold') && msg.message.includes('successfully to @')) ||
                      msg.message.includes('Trade is now in dispute.') ||
                      msg.message.includes('Trade cancelled.') ||
                      msg.message.includes('positive feedback') ||
                      msg.message.includes('negative feedback')
                    ));

                  if (isSystemMsg) {
                    return (
                      <WayonesSystemMessageBubble
                        key={msg.id}
                        msg={msg}
                        onOpenExternalLink={(url) => setSelectedExternalUrl(url)}
                        timezone={timezone}
                        language={language}
                      />
                    );
                  }

                  const isCurrentUser = msg.senderId === currentUserId;
                  const isModeratorOnly = msg.visibility === 'moderator_only';
                  const canViewModeratorFile = isAdmin || isCurrentUser;

                  let senderDisplayName = isCurrentUser ? `${t('tradeChat.roleYou')} (${userRoleLabel})` : `@${opponentUsername} (${opponentRoleLabel})`;
                  if (msg.isModerator) senderDisplayName = t('tradeChat.moderatorName');

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isCurrentUser ? 'justify-end' : 'justify-start')}>
                      {!isCurrentUser && (
                        <Avatar className="h-7 w-7 shrink-0 border border-border overflow-hidden bg-background">
                          {msg.isModerator ? (
                            <Image
                              src="/logo-mobile.webp"
                              alt={t('tradeChat.moderatorName')}
                              width={28}
                              height={28}
                              className="h-full w-full object-contain p-0.5"
                            />
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
                              <Lock className="h-2.5 w-2.5" /> {t('tradeChat.moderatorOnly')}
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
                                <span>{t('tradeChat.privateEvidence')}</span>
                              </div>
                            ) : msg.mediaType === 'image' ? (
                              <button
                                type="button"
                                onClick={() => openAttachmentPreview(msg.mediaUrl, 'image')}
                                className="block mt-1 text-left cursor-pointer group"
                              >
                                <img
                                  src={getMediaDisplayUrl(msg.mediaUrl)}
                                  alt={t('tradeChat.attachmentFile')}
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
                                <span>{t('tradeChat.viewAttachment').replace('{type}', msg.mediaUrl.split('.').pop()?.toUpperCase() || 'FILE')}</span>
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
              aria-label={t('tradeChat.attachEvidence')}
              title={t('tradeChat.attachEvidence')}
              disabled={isUploading || isTradeStopped}
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
                placeholder={t('tradeChat.messagePlaceholder')}
                disabled={isUploading || isTradeStopped}
                rows={2}
                className="w-full resize-none rounded-xl border border-input bg-background/50 px-3 py-2 text-xs sm:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus:bg-background transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={isUploading || isTradeStopped || !newMessage.trim()}
              aria-label={t('tradeChat.sendMessage')}
              title={t('tradeChat.sendMessage')}
              className="shrink-0 font-bold mb-1"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          <div className="hidden sm:flex items-center justify-between px-1 text-xs">
            <span className="text-[11px] text-muted-foreground">
              {t('tradeChat.enterToSend')} <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Enter ↵</kbd>, <kbd className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">Shift+Enter</kbd> {t('tradeChat.shiftEnterNewLine')}
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
              {t('tradeChat.externalLinkTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs text-foreground/90 space-y-2 pt-1">
              <p className="font-semibold text-destructive">
                {t('tradeChat.externalLinkWarning')}
              </p>
              <p>
                {t('tradeChat.externalLinkCredentialWarning')}
              </p>
            </DialogDescription>
          </DialogHeader>

          {selectedExternalUrl && (
            <div className="p-3 rounded-lg bg-muted/60 border border-border text-xs break-all font-mono">
              <span className="text-muted-foreground block text-[10px] uppercase font-sans font-bold mb-1">{t('tradeChat.targetDestination')}</span>
              {selectedExternalUrl}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="outline" size="sm" onClick={() => setSelectedExternalUrl(null)}>
              {t('tradeChat.cancelStaySafe')}
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
              {t('tradeChat.openExternalLink')}
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
              {t('tradeChat.privacyTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('tradeChat.privacyDescription')}
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
                <div className="text-foreground">{t('tradeChat.visibilityAllTitle')}</div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  {t('tradeChat.visibilityAllDescription')}
                </div>
              </Label>
            </div>

            <div className="flex items-center space-x-3 p-3 rounded-xl border border-destructive/30 bg-destructive/5 cursor-pointer">
              <RadioGroupItem value="moderator_only" id="opt-mod" />
              <Label htmlFor="opt-mod" className="cursor-pointer text-xs font-semibold">
                <div className="text-destructive flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> {t('tradeChat.visibilityModeratorTitle')}
                </div>
                <div className="text-[11px] text-muted-foreground font-normal">
                  {t('tradeChat.visibilityModeratorDescription')}
                </div>
              </Label>
            </div>
          </RadioGroup>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsPrivacyModalOpen(false)}>
              {t('common.cancel')}
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
              {t('tradeChat.uploadMedia')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Oversized Evidence Google Drive / Dropbox Guidance Modal */}
      <Dialog open={isOversizedModalOpen} onOpenChange={setIsOversizedModalOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-amber-500">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {t('tradeChat.fileLimitTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {oversizedFileInfo ? (
                <span>
                  {t('tradeChat.fileLimitSpecific').replace('{name}', oversizedFileInfo.name).replace('{size}', oversizedFileInfo.size)}
                </span>
              ) : (
                <span>{t('tradeChat.fileLimitGeneral')}</span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <p className="text-foreground leading-relaxed">
              {t('tradeChat.largeEvidenceIntro')}
            </p>

            {/* Google Drive Instructions */}
            <div className="p-3 rounded-xl border border-border bg-muted/20 space-y-1.5">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {t('tradeChat.googleDriveTitle')}
              </div>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground pl-1">
                <li>{t('tradeChat.googleDriveStep1')}</li>
                <li>{t('tradeChat.googleDriveStep2')}</li>
                <li>{t('tradeChat.googleDriveStep3')}</li>
                <li>{t('tradeChat.googleDriveStep4')}</li>
                <li>{t('tradeChat.googleDriveStep5')}</li>
              </ol>
            </div>

            {/* Dropbox Instructions */}
            <div className="p-3 rounded-xl border border-border bg-muted/20 space-y-1.5">
              <div className="font-bold text-foreground flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500" />
                {t('tradeChat.dropboxTitle')}
              </div>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground pl-1">
                <li>{t('tradeChat.dropboxStep1')}</li>
                <li>{t('tradeChat.dropboxStep2')}</li>
                <li>{t('tradeChat.dropboxStep3')}</li>
                <li>{t('tradeChat.dropboxStep4')}</li>
                <li>{t('tradeChat.dropboxStep5')}</li>
              </ol>
            </div>

            {/* Security Warning */}
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 space-y-1">
              <div className="font-bold flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                {t('tradeChat.securityWarningTitle')}
              </div>
              <p className="text-[11px] leading-relaxed">
                {t('tradeChat.securityWarningDescription')}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const instructions = `[Evidence Link Guide]\nGoogle Drive: Upload file -> Share -> Copy link -> Paste here.\nDropbox: Upload file -> Share -> Copy link -> Paste here.\nSecurity: Never share passwords or private keys.`;
                navigator.clipboard?.writeText(instructions);
                toast({ title: t('tradeChat.copiedTitle'), description: t('tradeChat.instructionsCopied') });
              }}
            >
              {t('tradeChat.copyInstructions')}
            </Button>
            <Button
              size="sm"
              onClick={() => setIsOversizedModalOpen(false)}
            >
              {t('tradeChat.understood')}
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
                <span className="truncate">{previewMedia?.filename || t('tradeChat.attachmentPreview')}</span>
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {t('tradeChat.inAppAttachmentView')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-[350px] max-h-[65vh] flex flex-col items-center justify-center p-2 bg-muted/20 rounded-xl border border-border/50 overflow-auto">
            {previewMedia?.type === 'image' ? (
              <img
                src={previewMedia.url}
                alt={t('tradeChat.attachmentPreview')}
                className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-xs"
              />
            ) : previewMedia?.type === 'video' ? (
              <video controls autoPlay className="max-h-[60vh] max-w-full rounded-lg" src={previewMedia.url} />
            ) : previewMedia?.isPdf ? (
              <iframe
                src={previewMedia.url}
                title={t('tradeChat.attachmentPreview')}
                className="w-full h-[60vh] rounded-lg border-0 bg-white"
              />
            ) : previewMedia?.isCsv ? (
              isLoadingPreviewContent ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-medium">{t('tradeChat.loadingSpreadsheet')}</span>
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
                <p className="text-xs text-muted-foreground">{t('tradeChat.csvRenderFailed')}</p>
              )
            ) : previewMedia?.isText ? (
              isLoadingPreviewContent ? (
                <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <span className="text-xs font-medium">{t('tradeChat.loadingText')}</span>
                </div>
              ) : (
                <pre className="w-full h-[60vh] overflow-auto bg-background rounded-lg p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                  {textContent || t('tradeChat.emptyDocument')}
                </pre>
              )
            ) : (
              <div className="p-8 text-center space-y-3">
                <FileText className="h-16 w-16 text-primary mx-auto" />
                <p className="text-sm font-semibold text-foreground">
                  {previewMedia?.filename || t('tradeChat.attachmentFile')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('tradeChat.downloadFile')}
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
                {t('tradeChat.downloadFile')}
              </a>
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPreviewMedia(null)}
              className="text-xs font-bold"
            >
              {t('tradeChat.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export { TradeChat as TradeChatSupabase };
export default TradeChat;
