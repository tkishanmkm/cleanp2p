'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useCountdown } from '@/hooks/use-countdown';
import { useAdminStatus } from '@/hooks/use-admin-status';
import {
  adminCancelTrade,
  adminMarkTradeAsPaid,
  adminReleaseFunds
} from '@/lib/admin-actions';
import {
  markTradeAsPaid,
  disputeTrade
} from '@/lib/wallet';
import { insertPaxonesSystemMessage, formatCryptoAmount } from '@/lib/trade-system-messages';
import { cn, toDate, playTradeBeep } from '@/lib/utils';
import { formatUserDateTimeArial, formatUtcDateTime } from '@/lib/date-utils';
import { useUserTimezone } from '@/hooks/use-user-timezone';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import type { Trade, P2PAd, Feedback } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage
} from '@/components/ui/form';
import {
  AlertCircle,
  Clock,
  Shield,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  RefreshCw,
  Gavel,
  ShieldAlert,
  AlertTriangle,
  FileText,
  UserCheck,
  Check,
  CheckCircle2,
  ShieldCheck,
  XCircle,
  Trophy,
  Tag
} from 'lucide-react';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import AdminActionDialog, { AdminActionType } from '@/components/admin/admin-action-dialog';
import { useI18n } from '@/context/i18n-context';

export function CoinInsignia({ symbol, className = "h-4 w-4" }: { symbol: string; className?: string }) {
  const s = (symbol || '').toUpperCase();
  switch (s) {
    case 'BTC':
      return (
        <span className="inline-flex items-center gap-1.5 font-bold font-mono">
          <BtcLogo className={className} />
          <span>BTC</span>
        </span>
      );
    case 'ETH':
      return (
        <span className="inline-flex items-center gap-1.5 font-bold font-mono">
          <EthLogo className={className} />
          <span>ETH</span>
        </span>
      );
    case 'USDT':
      return (
        <span className="inline-flex items-center gap-1.5 font-bold font-mono">
          <UsdtLogo className={className} />
          <span>USDT</span>
        </span>
      );
    case 'LTC':
      return (
        <span className="inline-flex items-center gap-1.5 font-bold font-mono">
          <LtcLogo className={className} />
          <span>LTC</span>
        </span>
      );
    default:
      return <span className="font-bold font-mono">{symbol}</span>;
  }
}

export const formatTradeId = (id?: string) => {
  if (!id) return '';
  const clean = id.replace(/[^a-zA-Z0-9]/g, '');
  if (clean.length >= 12) return clean.slice(0, 12).toUpperCase();
  return (clean + 'TRD890123456').slice(0, 12).toUpperCase();
};

const statusColors = {
  active: 'border-blue-500/40 text-blue-600 bg-blue-500/10 dark:text-blue-400',
  pending: 'border-yellow-500/40 text-yellow-600 bg-yellow-500/10 dark:text-yellow-400',
  paid: 'border-amber-500/40 text-amber-600 bg-amber-500/10 dark:text-amber-400',
  released: 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
  completed: 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10 dark:text-emerald-400',
  disputed: 'border-destructive/40 text-destructive bg-destructive/10',
  dispute: 'border-destructive/40 text-destructive bg-destructive/10',
  cancelled: 'border-muted-foreground/40 text-muted-foreground bg-muted',
  expired: 'border-rose-500/40 text-rose-600 bg-rose-500/10 dark:text-rose-400 font-bold'
};

const formatDateArial = (dateVal: any, customTz?: string): string => {
  return formatUserDateTimeArial(dateVal, customTz);
};

const DetailRow = ({
  label,
  value,
  isLink = false,
  href = '#',
  valueClass = '',
  boldLabel = false
}: {
  label: string;
  value: React.ReactNode;
  isLink?: boolean;
  href?: string;
  valueClass?: string;
  boldLabel?: boolean;
}) => (
  <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40 last:border-0">
    <div className={boldLabel ? "font-bold text-foreground" : "text-muted-foreground"}>{label}</div>
    {isLink ? (
      <Link href={href} className="font-mono font-bold text-primary hover:underline">
        {value}
      </Link>
    ) : (
      <div className={cn('font-medium text-foreground text-right', valueClass)}>{value}</div>
    )}
  </div>
);

const ParticipantRow = ({
  label,
  userId,
  fallbackUsername
}: {
  label: string;
  userId?: string;
  fallbackUsername?: string;
}) => {
  const supabase = createClient();
  const initialName = (fallbackUsername && fallbackUsername !== 'Trader' && fallbackUsername !== 'Buyer' && fallbackUsername !== 'Seller') ? fallbackUsername : null;
  const [displayUsername, setDisplayUsername] = useState<string | null>(initialName);
  const [merchantTier, setMerchantTier] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!userId) {
      if (initialName) {
        setDisplayUsername(initialName);
      }
      return;
    }

    const fetchUsername = async () => {
      // If it's a UUID, fetch profile
      if (userId.includes('-')) {
        const { data } = await supabase
          .from('public_profiles')
          .select('username, merchant_tier')
          .eq('id', userId)
          .maybeSingle();

        if (isMounted) {
          if (data?.username) {
            setDisplayUsername(data.username);
          } else if (initialName) {
            setDisplayUsername(initialName);
          }
          if (data?.merchant_tier) {
            setMerchantTier(data.merchant_tier);
          }
        }
        return;
      }
      if (isMounted) {
        setDisplayUsername(initialName || (userId && !userId.includes('-') ? userId : null));
      }
    };

    fetchUsername();
    return () => {
      isMounted = false;
    };
  }, [userId, fallbackUsername, initialName, supabase]);

  return (
    <div className="flex justify-between items-center text-xs sm:text-sm py-1.5 border-b border-border/40">
      <div className="font-bold text-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        {displayUsername ? (
          <Link
            href={`/users/${displayUsername}`}
            className="font-bold text-primary hover:underline flex items-center gap-1.5"
          >
            <span>@{displayUsername}</span>
          </Link>
        ) : (
          <span className="h-4 w-20 bg-muted animate-pulse rounded inline-block" />
        )}
        {merchantTier && <MerchantBadge tier={merchantTier} size="sm" />}
      </div>
    </div>
  );
};

const ISSUE_OPTIONS = [
  'I have been chargebacked / Payment reversed',
  'Suspected hacking or phishing attempt',
  'Intentional coin locking / Unresponsive counterparty',
  'Third-party payment used without authorization',
  'Impersonation or fake payment receipt',
  'Off-platform communication / Contact sharing attempt',
  'Incorrect payment amount or currency mismatch',
  'Other fraudulent or suspicious activity'
];

export function ReportIssueDialog({
  trade,
  currentUserId,
  currentUsername,
  counterpartId
}: {
  trade: Trade | any;
  currentUserId: string;
  currentUsername: string;
  counterpartId?: string;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string>('');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUserReported, setHasUserReported] = useState(false);

  useEffect(() => {
    if (!trade?.id || !currentUserId) return;
    const checkReport = async () => {
      const { data } = await supabase
        .from('disputes')
        .select('id, opened_by')
        .eq('trade_id', trade.id);

      if (data && data.some((d: any) => d.opened_by === currentUserId || (currentUsername && d.opened_by === currentUsername))) {
        setHasUserReported(true);
      }
    };
    checkReport();
  }, [trade?.id, currentUserId, currentUsername, supabase]);

  const handleSubmitIssue = async () => {
    if (!selectedIssue) {
      toast({ variant: 'destructive', title: t('tradeActionPage.selectIssueToastTitle'), description: t('tradeActionPage.selectIssueToastDescription') });
      return;
    }
    if (!details.trim()) {
      toast({ variant: 'destructive', title: t('tradeActionPage.detailsRequiredToastTitle'), description: t('tradeActionPage.detailsRequiredToastDescription') });
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Insert into disputes/support table
      await supabase.from('disputes').insert([
        {
          trade_id: trade.id,
          opened_by: currentUserId,
          reason: selectedIssue,
          explanation: details.trim(),
          status: 'open',
          created_at: new Date().toISOString()
        }
      ]);

      // 2. Post as system message into trade_messages
      await insertPaxonesSystemMessage(supabase, {
        tradeId: trade.id,
        type: 'ISSUE_REPORTED',
        openerUsername: currentUsername || 'Trader',
        issueCategory: selectedIssue,
        issueDetails: details.trim()
      });

      // 3. Create notification for opponent
      if (counterpartId) {
        await supabase.from('notifications').insert([
          {
            user_id: counterpartId,
            title: 'Issue Reported',
            message: `@${currentUsername} filed an issue report for trade ${formatTradeId(trade.id)}: ${selectedIssue}`,
            type: 'report',
            metadata: { link: `/trade/${trade.id}` },
            is_read: false,
            created_at: new Date().toISOString()
          }
        ]);
      }

      toast({
        title: t('tradeActionPage.reportSuccessTitle'),
        description: t('tradeActionPage.reportSuccessDescription')
      });
      setHasUserReported(true);
      setIsOpen(false);
      setSelectedIssue('');
      setDetails('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('tradeActionPage.reportFailedTitle'), description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (hasUserReported) {
    return (
      <Button
        disabled
        className="w-full py-2.5 bg-muted/80 text-muted-foreground font-bold text-xs sm:text-sm rounded-xl border border-border/80 shadow-none flex items-center justify-center gap-2 cursor-not-allowed opacity-90"
      >
        <UserCheck className="h-4 w-4 text-emerald-500" />
        <span>{t('tradeActionPage.reported')}</span>
      </Button>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          className="w-full py-2.5 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold text-xs sm:text-sm rounded-xl border border-red-600 shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          <span>{t('tradeActionPage.reportButton')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t('tradeActionPage.reportDialogTitle')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('tradeActionPage.reportDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t('tradeActionPage.issueCategoryLabel')}</Label>
            <Select value={selectedIssue} onValueChange={setSelectedIssue}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder={t('tradeActionPage.issuePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_OPTIONS.map((opt, idx) => (
                  <SelectItem key={idx} value={opt} className="text-xs">
                    {idx + 1}. {t('tradeActionPage.issueOption' + (idx + 1))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">{t('tradeActionPage.issueDetailsLabel')}</Label>
            <Textarea
              placeholder={t('tradeActionPage.evidencePlaceholder')}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="text-xs min-h-[90px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSubmitIssue}
            disabled={isSubmitting || !selectedIssue || !details.trim()}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            {t('tradeActionPage.submitReport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OpenDisputeDialog({
  trade,
  currentUserId,
  currentUsername,
  disabled
}: {
  trade: Trade | any;
  currentUserId: string;
  currentUsername: string;
  disabled: boolean;
}) {
  const { toast } = useToast();
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState('Payment Issue');
  const [customReason, setCustomReason] = useState('');
  const [explanation, setExplanation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const disputeReasons = [
    'Payment Issue',
    'Intentional coin locking',
    'Buyer not paid and marked paid',
    'Seller is not releasing',
    'Trade partner unresponsive',
    'Custom'
  ];
  const disputeReasonLabels: Record<string, string> = {
    'Payment Issue': t('tradeActionPage.reasonPaymentIssue'),
    'Intentional coin locking': t('tradeActionPage.reasonIntentionalLocking'),
    'Buyer not paid and marked paid': t('tradeActionPage.reasonBuyerPaidNotSent'),
    'Seller is not releasing': t('tradeActionPage.reasonSellerNotReleasing'),
    'Trade partner unresponsive': t('tradeActionPage.reasonPartnerUnresponsive'),
    Custom: t('tradeActionPage.reasonCustom'),
  };

  const handleSubmit = async () => {
    const finalReason = selectedReason === 'Custom' ? (customReason.trim() || 'Custom Reason') : selectedReason;
    if (!explanation.trim()) {
      toast({ variant: 'destructive', title: t('tradeActionPage.explanationRequiredToastTitle'), description: t('tradeActionPage.explanationRequiredToastDescription') });
      return;
    }
    if (selectedReason === 'Custom' && !customReason.trim()) {
      toast({ variant: 'destructive', title: t('tradeActionPage.customReasonRequiredToastTitle'), description: t('tradeActionPage.customReasonRequiredToastDescription') });
      return;
    }
    setIsSubmitting(true);
    try {
      const fullReason = `${finalReason}: ${explanation.trim()}`;
      const res = await fetch(`/api/trades/${trade.id}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: fullReason }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || t('tradeActionPage.disputeFailedToastTitle'));
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trade-updated', {
            detail: {
              status: 'disputed',
              escrow_status: 'DISPUTED',
              is_disputed: true,
              dispute_reason: fullReason,
            },
          })
        );
      }

      toast({ title: t('tradeActionPage.disputeOpenedToastTitle'), description: t('tradeActionPage.disputeOpenedToastDescription') });
      setIsOpen(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: t('tradeActionPage.disputeFailedToastTitle'), description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="w-full text-xs font-bold" disabled={disabled}>
          <ShieldAlert className="mr-2 h-4 w-4" /> {t('tradeActionPage.openDisputeButton')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('tradeActionPage.openDisputeTitle')}</DialogTitle>
          <DialogDescription>
            {t('tradeActionPage.openDisputeDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">{t('tradeActionPage.reasonLabel')}</Label>
            <Select value={selectedReason} onValueChange={setSelectedReason}>
              <SelectTrigger className="text-xs mt-1">
                <SelectValue placeholder={t('tradeActionPage.reasonPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {disputeReasons.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {disputeReasonLabels[r] || r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedReason === 'Custom' && (
            <div>
              <Label className="text-xs">{t('tradeActionPage.customReasonLabel')}</Label>
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder={t('tradeActionPage.customReasonPlaceholder')}
                className="text-xs mt-1"
              />
            </div>
          )}
          <div>
            <Label className="text-xs">{t('tradeActionPage.explanationLabel')}</Label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder={t('tradeActionPage.explanationPlaceholder')}
              className="text-xs mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('tradeActionPage.confirmDispute')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function resolveTradeStatus(t: any): string {
  if (!t) return 'active';
  const raw = String(t.status || '').toLowerCase();
  
  // 1. Released or completed is a terminal state - always highest precedence
  if (
    t.released_at ||
    t.completed_at ||
    String(t.escrow_status || '').toUpperCase() === 'RELEASED' ||
    raw === 'released' ||
    raw === 'completed'
  ) {
    return 'released';
  }

  // 2. Cancelled is a terminal state - MUST precede dispute checks
  // (Prevents cancelled disputed trades from remaining stuck as 'disputed')
  if (
    t.cancelled_at ||
    String(t.escrow_status || '').toUpperCase() === 'CANCELLED' ||
    String(t.escrow_status || '').toUpperCase() === 'REFUNDED' ||
    raw === 'cancelled' ||
    raw === 'canceled'
  ) {
    return 'cancelled';
  }

  // 3. Expired terminal state
  if (
    t.expired_at ||
    String(t.escrow_status || '').toUpperCase() === 'EXPIRED' ||
    raw === 'expired'
  ) {
    return 'expired';
  }

  // 4. Disputed state - only active if not in a terminal completed/cancelled state
  if (
    String(t.escrow_status || '').toUpperCase() === 'DISPUTED' ||
    raw === 'disputed' ||
    raw === 'dispute' ||
    (t.is_disputed === true && raw !== 'cancelled' && raw !== 'released' && raw !== 'expired')
  ) {
    return 'disputed';
  }

  // 5. Paid state
  if (
    t.paid_at ||
    t.marked_paid_at ||
    String(t.escrow_status || '').toUpperCase() === 'PAID' ||
    raw === 'paid' ||
    raw === 'buyer_marked_paid' ||
    raw === 'payment_sent'
  ) {
    return 'paid';
  }

  return raw || 'active';
}

const ActionButtons = ({
  trade,
  currentUserRole,
  currentUserId,
  currentUsername,
  counterpartId,
  isExpired,
  resolvedDispute
}: {
  trade: Trade | any;
  currentUserRole: 'buy' | 'sell';
  currentUserId?: string;
  currentUsername?: string;
  counterpartId?: string;
  isExpired?: boolean;
  resolvedDispute?: any;
}) => {
  const { toast } = useToast();
  const { t } = useI18n();
  const tradeStatus = resolveTradeStatus(trade);
  const isBuyer = currentUserRole === 'buy';
  const isTradeExpired = Boolean(isExpired || tradeStatus === 'expired');
  const isTerminal = ['released', 'completed', 'cancelled', 'expired'].includes(tradeStatus);

  const [didNotPayChecked, setDidNotPayChecked] = useState(false);
  const [isPaidConfirmOpen, setIsPaidConfirmOpen] = useState(false);
  const [isReleaseConfirmOpen, setIsReleaseConfirmOpen] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [is2faActive, setIs2faActive] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const adPaymentMethods = Array.isArray(trade.ad?.payment_methods) && trade.ad?.payment_methods.length > 0
    ? trade.ad?.payment_methods
    : (trade.payment_method ? [trade.payment_method] : ['Bank Transfer']);
  const [selectedMarkPaidMethod, setSelectedMarkPaidMethod] = useState(trade.payment_method || adPaymentMethods[0] || 'Bank Transfer');

  const isOpenDispute = Boolean(
    (resolvedDispute && ['open', 'OPEN', 'pending', 'PENDING', 'in_review', 'IN_REVIEW', 'investigating'].includes(resolvedDispute?.status)) ||
    (trade?.dispute && ['open', 'OPEN', 'pending', 'PENDING', 'in_review', 'IN_REVIEW', 'investigating'].includes(trade?.dispute?.status))
  );
  const activeDispute = !isTerminal && isOpenDispute ? (resolvedDispute || trade?.dispute || null) : null;
  const isTradeInDispute = !isTerminal && (tradeStatus === 'disputed' || tradeStatus === 'dispute' || isOpenDispute);

  const markedPaidAt = trade?.marked_paid_at || trade?.paid_at || trade?.updated_at;
  const paidTimeMs = markedPaidAt ? new Date(markedPaidAt).getTime() : 0;
  const disputeEligibleTimeMs = paidTimeMs > 0 ? paidTimeMs + (3 * 60 * 60 * 1000) : 0;
  const disputeTimeRemaining = useCountdown(tradeStatus === 'paid' && disputeEligibleTimeMs > 0 ? disputeEligibleTimeMs : 0);
  const isDisputeEligible = tradeStatus === 'paid' && (disputeEligibleTimeMs === 0 || disputeTimeRemaining.isFinished || disputeEligibleTimeMs <= Date.now());

  useEffect(() => {
    playTradeBeep();
  }, []);

  useEffect(() => {
    if (tradeStatus === 'released') {
      playTradeBeep();
    }
  }, [tradeStatus]);

  useEffect(() => {
    if (isReleaseConfirmOpen && currentUserId) {
      const check2FA = async () => {
        try {
          const supabase = createClient();
          const { data, error } = await supabase.rpc('get_user_2fa_status', {
            p_user_id: currentUserId,
          });
          if (!error && typeof data === 'boolean') {
            setIs2faActive(data);
          }
        } catch (err) {
          console.warn('Failed to check 2FA status:', err);
        }
      };
      check2FA();
    }
  }, [isReleaseConfirmOpen, currentUserId]);

  const canMarkPaid = !isTradeExpired && !isTerminal && isBuyer && (tradeStatus === 'active' || tradeStatus === 'pending');
  // CRITICAL ESCROW RULE: The Release Escrow button MUST strictly render ONLY when trade status is PAID or DISPUTED and not terminal
  const canRelease = !isTerminal && !isBuyer && (
    tradeStatus === 'paid' || 
    tradeStatus === 'buyer_marked_paid' || 
    tradeStatus === 'payment_sent' || 
    isTradeInDispute
  );
  // CRITICAL ESCROW RULE: Buyer can cancel ONLY when the trade is in an active/pending UNPAID state,
  // before payment is marked or sent, and when no dispute is active.
  const isPaidOrMarked = Boolean(
    trade?.paid_at || 
    trade?.marked_paid_at || 
    tradeStatus === 'paid' || 
    tradeStatus === 'buyer_marked_paid' || 
    tradeStatus === 'payment_sent' ||
    String(trade?.escrow_status || '').toUpperCase() === 'PAID'
  );
  const canBuyerCancel = !isTradeExpired && !isTerminal && !isTradeInDispute && !isPaidOrMarked && isBuyer && (
    tradeStatus === 'active' || 
    tradeStatus === 'pending'
  );

  const handleMarkAsPaid = async () => {
    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_PAID', paymentMethod: selectedMarkPaidMethod })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || t('tradeActionPage.markPaidFailed'));

      const nowIso = new Date().toISOString();
      if (trade) {
        trade.marked_paid_at = nowIso;
        trade.paid_at = nowIso;
        trade.escrow_status = 'PAID';
        trade.status = 'paid';
        trade.payment_method = selectedMarkPaidMethod;
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trade-updated', {
            detail: {
              marked_paid_at: nowIso,
              paid_at: nowIso,
              escrow_status: 'PAID',
              status: 'paid',
              payment_method: selectedMarkPaidMethod,
            },
          })
        );
      }

      toast({ title: t('tradeActionPage.markPaidToastTitle'), description: t('tradeActionPage.markPaidToastDescription') });
      setIsPaidConfirmOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: t('tradeActionPage.errorTitle'), description: e.message });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReleaseCrypto = async () => {
    if (is2faActive && !/^\d{6}$/.test(totpCode.trim())) {
      toast({
        variant: 'destructive',
        title: t('tradeActionPage.twoFactorRequired'),
        description: t('tradeActionPage.otpHelper'),
      });
      return;
    }

    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RELEASE_ESCROW', totpCode: totpCode.trim() })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || t('tradeActionPage.releaseFailed'));

      const nowIso = new Date().toISOString();
      if (trade) {
        trade.released_at = nowIso;
        trade.completed_at = nowIso;
        trade.escrow_status = 'RELEASED';
        trade.status = 'released';
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trade-updated', {
            detail: {
              released_at: nowIso,
              completed_at: nowIso,
              escrow_status: 'RELEASED',
              status: 'released',
            },
          })
        );
      }

      toast({ title: t('tradeActionPage.escrowReleasedToastTitle'), description: t('tradeActionPage.escrowReleasedToastDescription') });
      setIsReleaseConfirmOpen(false);
      setTotpCode('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: t('tradeActionPage.errorTitle'), description: e.message });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleCancelTrade = async () => {
    if (isPaidOrMarked || isTradeInDispute || isTerminal) {
      toast({
        variant: 'destructive',
        title: t('tradeActionPage.cancellationProhibitedTitle'),
        description: t('tradeActionPage.cancellationProhibitedDescription'),
      });
      return;
    }

    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CANCEL_TRADE', reason: 'Cancelled by buyer (confirmed no payment sent)' })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || t('tradeActionPage.cancelFailed'));

      const nowIso = new Date().toISOString();
      if (trade) {
        trade.cancelled_at = nowIso;
        trade.escrow_status = 'CANCELLED';
        trade.status = 'cancelled';
        trade.is_disputed = false;
        if (trade.dispute) {
          trade.dispute.status = 'RESOLVED';
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('trade-updated', {
            detail: {
              cancelled_at: nowIso,
              escrow_status: 'CANCELLED',
              status: 'cancelled',
              is_disputed: false,
            },
          })
        );
      }

      toast({ title: t('tradeActionPage.tradeCancelledToastTitle'), description: t('tradeActionPage.tradeCancelledToastDescription') });
    } catch (e: any) {
      toast({ variant: 'destructive', title: t('tradeActionPage.errorTitle'), description: e.message });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2">
        {canMarkPaid && (
          <AlertDialog open={isPaidConfirmOpen} onOpenChange={setIsPaidConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-2.5 text-sm shadow-md transition-all">
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> {t('tradeActionPage.markPaidButton')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card text-card-foreground border-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground">{t('tradeActionPage.confirmPaymentTitle')}</AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  {t('tradeActionPage.confirmPaymentDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {adPaymentMethods.length > 1 ? (
                <div className="space-y-1.5 py-2 text-left">
                  <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                    <span>{t('tradeActionPage.paymentMethodUsed')}</span>
                    <span className="text-rose-500 font-bold">* {t('tradeActionPage.required')}</span>
                  </label>
                  <select
                    value={selectedMarkPaidMethod}
                    onChange={(e) => setSelectedMarkPaidMethod(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg border bg-background text-xs font-semibold text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                  >
                    {adPaymentMethods.map((m: string) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex justify-between items-center px-3 py-2 rounded-lg bg-muted/40 border text-xs my-1">
                  <span className="text-muted-foreground font-medium">{t('tradeActionPage.paymentMethod')}</span>
                  <span className="font-semibold text-foreground">{selectedMarkPaidMethod}</span>
                </div>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>{t('tradeActionPage.goBack')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleMarkAsPaid} disabled={isSubmittingAction} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  {t('tradeActionPage.confirmPaid')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canRelease && (
          <AlertDialog
            open={isReleaseConfirmOpen}
            onOpenChange={(open) => {
              setIsReleaseConfirmOpen(open);
              if (!open) setTotpCode('');
            }}
          >
            <AlertDialogTrigger asChild>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-2.5 text-sm shadow-md transition-all">
                <ShieldCheck className="mr-1.5 h-4 w-4" /> {t('tradeActionPage.releaseButton')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="sm:max-w-md bg-card text-card-foreground border-border">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-foreground">{t('tradeActionPage.releaseTitle')}</AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  {t('tradeActionPage.releaseWarning')}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {is2faActive && (
                <div className="space-y-2 py-2">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <Label htmlFor="release-totp" className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Shield className="h-4 w-4" />
                      {t('tradeActionPage.twoFactorRequired')}
                    </Label>
                    <Input
                      id="release-totp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder={t('tradeActionPage.otpPlaceholder')}
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      className="font-mono text-center tracking-widest bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {t('tradeActionPage.otpHelper')}
                    </p>
                  </div>
                </div>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReleaseCrypto}
                  disabled={isSubmittingAction || (is2faActive && !/^\d{6}$/.test(totpCode.trim()))}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  {t('tradeActionPage.confirmRelease')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canBuyerCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full text-xs font-bold text-destructive border-destructive/30 hover:bg-destructive/10">
                <XCircle className="mr-1.5 h-3.5 w-3.5" /> {t('tradeActionPage.cancelTradeButton')}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base text-destructive flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  {t('tradeActionPage.cancelConfirmTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-foreground/80">
                  {t('tradeActionPage.cancelConfirmDescription')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-3 py-2">
                <div className="flex items-start space-x-2.5 p-3 rounded-xl border border-destructive/20 bg-destructive/5">
                  <Checkbox
                    id="did-not-pay-check"
                    checked={didNotPayChecked}
                    onCheckedChange={(checked) => setDidNotPayChecked(Boolean(checked))}
                    className="mt-0.5"
                  />
                  <Label htmlFor="did-not-pay-check" className="text-xs font-semibold leading-snug cursor-pointer">
                    {t('tradeActionPage.notSentPayment')}
                  </Label>
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('tradeActionPage.keepTrade')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleCancelTrade}
                  disabled={!didNotPayChecked || isSubmittingAction}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  {t('tradeActionPage.confirmCancellation')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {tradeStatus === 'paid' && currentUserId && !activeDispute && (
          <div className="space-y-2">
            {!isDisputeEligible && (
              <p className="text-[11px] text-muted-foreground text-center">
                {t('tradeActionPage.disputeAvailableIn')} <span className="font-mono font-bold text-foreground">{String(disputeTimeRemaining.hours).padStart(2, '0')}:{String(disputeTimeRemaining.minutes).padStart(2, '0')}:{String(disputeTimeRemaining.seconds).padStart(2, '0')}</span> {t('tradeActionPage.disputeAvailableWindow')}
              </p>
            )}
            <OpenDisputeDialog
              trade={trade}
              currentUserId={currentUserId}
              currentUsername={currentUsername || 'user'}
              disabled={!isDisputeEligible}
            />
          </div>
        )}

        {(activeDispute || tradeStatus === 'disputed') && (
          <div className="rounded-xl border border-destructive/40 p-3 bg-destructive/10 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-destructive">
              <ShieldAlert className="h-4 w-4" />
              <span>{t('tradeActionPage.officialDisputeOpened')}</span>
            </div>
            <p className="text-xs text-foreground">
              {t('tradeActionPage.reasonLabel')}: <span className="font-semibold">{activeDispute?.reason || 'Payment or Escrow Dispute'}</span>
            </p>
            {activeDispute?.explanation && (
              <p className="text-xs text-muted-foreground italic">
                &ldquo;{activeDispute.explanation}&rdquo;
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const feedbackSchema = z.object({
  rating: z.enum(['positive', 'negative'], { message: 'Please select a rating.' }),
  comment: z.string().min(1, 'Comment is required.').max(500, 'Comment cannot exceed 500 characters.')
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

function FeedbackForm({
  trade,
  existingFeedback,
  receivedFeedback,
  onFeedbackSaved,
  currentUserId,
  currentUsername,
  counterpartId,
  counterpartUsername,
}: {
  trade: Trade | any;
  existingFeedback?: Feedback;
  receivedFeedback?: Feedback;
  onFeedbackSaved?: (fb: Feedback) => void;
  currentUserId?: string;
  currentUsername?: string;
  counterpartId?: string;
  counterpartUsername?: string;
}) {
  const { toast } = useToast();
  const { t, language } = useI18n();

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      rating: existingFeedback?.rating || 'positive',
      comment: existingFeedback?.comment || ''
    }
  });

  useEffect(() => {
    if (existingFeedback) {
      form.reset({
        rating: existingFeedback.rating,
        comment: existingFeedback.comment || ''
      });
    }
  }, [existingFeedback, form]);

  const { isSubmitting } = form.formState;

  async function onSubmit(values: FeedbackFormValues) {
    if (!currentUserId) {
      toast({ variant: 'destructive', title: t('tradeFeedbackPage.loginRequiredTitle'), description: t('tradeFeedbackPage.loginRequiredDescription') });
      return;
    }

    const opponentId = counterpartId || (currentUserId === (trade.buyerId || trade.buyer_id) ? (trade.sellerId || trade.seller_id) : (trade.buyerId || trade.buyer_id));

    try {
      let savedFbRecord: any = null;

      // Submit through the authenticated compatibility API. The handler writes
      // only to canonical feedbacks and the database enforces completed-counterparty
      // eligibility plus one-review-per-trade uniqueness.
      const res = await fetch('/api/trade/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeId: trade.id,
          rating: values.rating,
          comment: values.comment,
          counterpartId: opponentId,
        }),
      });
      const apiData = await res.json().catch(() => null);
      if (!res.ok || apiData?.success !== true || !apiData.feedback) {
        throw new Error(apiData?.error || t('tradeFeedbackPage.saveUnconfirmed'));
      }
      savedFbRecord = apiData.feedback;
      const updatedFb: Feedback = {
        id: savedFbRecord?.id || existingFeedback?.id || 'fb_' + Date.now(),
        tradeId: trade.id,
        fromUser: currentUserId,
        fromUsername: currentUsername || 'Trader',
        toUser: opponentId,
        rating: values.rating,
        comment: values.comment,
        createdAt: savedFbRecord?.created_at || existingFeedback?.createdAt || new Date().toISOString()
      };

      onFeedbackSaved?.(updatedFb);

      toast({
        title: t('tradeFeedbackPage.savedTitle'),
        description: t('tradeFeedbackPage.savedDescription')
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: t('tradeFeedbackPage.failedTitle'), description: t('tradeFeedbackPage.failedDescription').replace('{error}', error.message || '') });
    }
  }

  const isPositive = existingFeedback?.rating === 'positive';
  const isReceivedPositive = receivedFeedback?.rating === 'positive';

  return (
    <div className="space-y-4 pt-3 border-t border-border/60">
      {/* 1. FEEDBACK I RECEIVED SECTION */}
      {receivedFeedback && (
        <div className="space-y-2 rounded-xl border border-border/60 p-3 bg-muted/10">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-primary" /> {t('tradeFeedbackPage.receivedFrom').replace('{username}', counterpartUsername || t('tradeFeedbackPage.traderFallback'))}
            </h4>
          </div>

          <div className={cn(
            'p-3 rounded-xl border text-xs space-y-1.5 shadow-2xs',
            isReceivedPositive
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100'
          )}>
            <div className="flex items-center justify-between">
              <span className={cn(
                'inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md text-[11px]',
                isReceivedPositive
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
              )}>
                {isReceivedPositive ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                {isReceivedPositive ? t('tradeFeedbackPage.positive') : t('tradeFeedbackPage.negative')}
              </span>
              <span className="text-[10px] opacity-75 font-mono">
                {receivedFeedback.createdAt ? toDate(receivedFeedback.createdAt)?.toLocaleDateString(language) : t('tradeFeedbackPage.recorded')}
              </span>
            </div>
            {receivedFeedback.comment && (
              <p className="text-xs italic leading-relaxed pt-1 whitespace-pre-wrap">&quot;{receivedFeedback.comment}&quot;</p>
            )}
          </div>
        </div>
      )}

      {/* 2. FEEDBACK I GAVE SECTION */}
      {existingFeedback ? (
        <div className="space-y-2 rounded-xl border border-border/60 p-3 bg-muted/10">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
              <ThumbsUp className="h-3.5 w-3.5 text-primary" /> {t('tradeFeedbackPage.givenByMe')}
            </h4>
          </div>

          <div className={cn(
            'p-3 rounded-xl border text-xs space-y-1.5 shadow-2xs',
            isPositive
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950 dark:text-emerald-100'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-950 dark:text-rose-100'
          )}>
            <div className="flex items-center justify-between">
              <span className={cn(
                'inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md text-[11px]',
                isPositive
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/20 text-rose-700 dark:text-rose-300'
              )}>
                {isPositive ? <ThumbsUp className="h-3 w-3" /> : <ThumbsDown className="h-3 w-3" />}
                {isPositive ? t('tradeFeedbackPage.positive') : t('tradeFeedbackPage.negative')}
              </span>
              <span className="text-[10px] opacity-75 font-mono">
                {existingFeedback.createdAt ? toDate(existingFeedback.createdAt)?.toLocaleDateString(language) : t('tradeFeedbackPage.recorded')}
              </span>
            </div>
            {existingFeedback.comment && (
              <p className="text-xs italic leading-relaxed pt-1 whitespace-pre-wrap">&quot;{existingFeedback.comment}&quot;</p>
            )}
          </div>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 rounded-xl border border-border/60 p-3 bg-muted/10">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-xs text-foreground">
                {t('tradeFeedbackPage.leaveFeedbackFor').replace('{username}', counterpartUsername || t('tradeFeedbackPage.traderFallback'))}
              </h4>
            </div>
            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem className="space-y-2">
                  <FormControl>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => field.onChange('positive')}
                        className={cn(
                          'flex items-center justify-center gap-2 py-2.5 px-3 border rounded-xl transition-all text-xs font-semibold cursor-pointer select-none',
                          field.value === 'positive'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs ring-1 ring-emerald-500/30'
                            : 'border-border/60 hover:bg-muted/60 text-muted-foreground'
                        )}
                      >
                        <ThumbsUp className={cn("h-4 w-4", field.value === 'positive' ? "text-emerald-600 dark:text-emerald-400 fill-emerald-500/20" : "text-muted-foreground")} />
                        <span>{t('tradeFeedbackPage.positive')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => field.onChange('negative')}
                        className={cn(
                          'flex items-center justify-center gap-2 py-2.5 px-3 border rounded-xl transition-all text-xs font-semibold cursor-pointer select-none',
                          field.value === 'negative'
                            ? 'border-rose-500 bg-rose-500/15 text-rose-700 dark:text-rose-300 font-bold shadow-xs ring-1 ring-rose-500/30'
                            : 'border-border/60 hover:bg-muted/60 text-muted-foreground'
                        )}
                      >
                        <ThumbsDown className={cn("h-4 w-4", field.value === 'negative' ? "text-rose-600 dark:text-rose-400 fill-rose-500/20" : "text-muted-foreground")} />
                        <span>{t('tradeFeedbackPage.negative')}</span>
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage className="text-center text-xs" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="comment"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      placeholder={t('tradeFeedbackPage.commentPlaceholder')}
                      className="text-xs min-h-[70px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
            <Button type="submit" size="sm" className="w-full text-xs font-bold" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t('tradeFeedbackPage.submitFeedback')}
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}

function AdminTradeActions({ trade, adminUserId }: { trade: Trade | any; adminUserId?: string }) {
  const supabase = createClient();
  const { toast } = useToast();
  const { t } = useI18n();
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    action: AdminActionType | null;
  }>({ open: false, action: null });

  const handleActionConfirm = async (reason: string) => {
    if (!dialogState.action || !adminUserId) return;
    const { action } = dialogState;

    try {
      if (action === 'cancel') await adminCancelTrade(supabase, trade, adminUserId, reason);
      else if (action === 'paid') await adminMarkTradeAsPaid(supabase, trade, adminUserId, reason);
      else if (action === 'release') await adminReleaseFunds(supabase, trade, adminUserId, reason);
      else if (action === 'award_buyer' || action === 'award_seller') {
        const { data: dispute } = await supabase
          .from('disputes')
          .select('*')
          .eq('trade_id', trade.id)
          .eq('status', 'open')
          .maybeSingle();

        if (!dispute?.id) {
          throw new Error(t('tradeDetailsPage.adminFailedTitle'));
        }

        const resolution = action === 'award_buyer' ? 'RELEASE' : 'CANCEL';
        const response = await fetch('/api/admin/disputes/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            disputeId: dispute.id,
            tradeId: trade.id,
            resolution,
            notes: reason
          })
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || result?.success !== true) {
          throw new Error(typeof result?.error === 'string' ? result.error : t('tradeDetailsPage.adminFailedTitle'));
        }
      }
      toast({ title: t('tradeDetailsPage.adminSuccessTitle'), description: t('tradeDetailsPage.adminSuccessDescription') });
    } catch (e: any) {
      toast({ variant: 'destructive', title: t('tradeDetailsPage.adminFailedTitle'), description: e.message });
    } finally {
      setDialogState({ open: false, action: null });
    }
  };

  const tradeStatus = resolveTradeStatus(trade);

  return (
    <>
      <AdminActionDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        user={null}
        action={dialogState.action}
        onConfirm={handleActionConfirm}
      />
      <Card className="border-destructive/50 bg-destructive/5 mt-4">
        <CardHeader className="py-2.5 px-3">
          <CardTitle className="flex items-center gap-1.5 text-xs text-destructive font-bold">
            <Shield className="h-4 w-4" />
            {t('tradeDetailsPage.adminEscrowControls')}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-1.5 p-3 pt-0">
          {tradeStatus === 'disputed' || tradeStatus === 'dispute' ? (
            <>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'award_buyer' })}>
                <Gavel className="mr-1 h-3.5 w-3.5" /> {t('tradeDetailsPage.awardBuyer')}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'award_seller' })}>
                <Gavel className="mr-1 h-3.5 w-3.5" /> {t('tradeDetailsPage.awardSeller')}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'cancel' })}>
                {t('tradeDetailsPage.adminCancelTrade')}
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'paid' })}>
                {t('tradeDetailsPage.adminMarkPaid')}
              </Button>
              <Button size="sm" variant="outline" className="col-span-2 text-xs" onClick={() => setDialogState({ open: true, action: 'release' })}>
                {t('tradeDetailsPage.adminReleaseFunds')}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export function TradeDetails({
  trade,
  ad,
  currentUserRole
}: {
  trade: Trade | any;
  ad?: P2PAd | null | any;
  currentUserRole: 'buy' | 'sell';
}) {
  const supabase = createClient();
  const { t, language } = useI18n();
  const { timezone } = useUserTimezone();
  const isBuying = currentUserRole === 'buy';
  const tradeStatus = resolveTradeStatus(trade);
  const { isAdmin } = useAdminStatus();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [existingFeedback, setExistingFeedback] = useState<Feedback | undefined>(undefined);
  const [receivedFeedback, setReceivedFeedback] = useState<Feedback | undefined>(undefined);
  const [resolvedDispute, setResolvedDispute] = useState<any>(null);

  const buyerId = trade?.buyer_id || trade?.buyerId;
  const sellerId = trade?.seller_id || trade?.sellerId;
  const opponentId = currentUser?.id === buyerId ? sellerId : buyerId;
  const opponentUsername = isBuying
    ? (trade?.seller?.username || trade?.seller_username || t('tradeDetailsPage.seller'))
    : (trade?.buyer?.username || trade?.buyer_username || t('tradeDetailsPage.buyer'));

  useEffect(() => {
    async function loadAuthAndTradeDetails() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);

        // Fetch existing feedback for this specific trade
        if (trade?.id) {
          try {
            const apiRes = await fetch(`/api/trade/feedback?tradeId=${trade.id}`, { credentials: 'include' });
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              if (apiData?.feedback) {
                setExistingFeedback({
                  id: apiData.feedback.id,
                  tradeId: apiData.feedback.trade_id,
                  fromUser: apiData.feedback.from_user,
                  fromUsername: apiData.feedback.from_username,
                  toUser: apiData.feedback.to_user,
                  rating: apiData.feedback.rating,
                  comment: apiData.feedback.comment,
                  createdAt: apiData.feedback.created_at,
                });
              }
              if (apiData?.receivedFeedback) {
                setReceivedFeedback({
                  id: apiData.receivedFeedback.id,
                  tradeId: apiData.receivedFeedback.trade_id,
                  fromUser: apiData.receivedFeedback.from_user,
                  fromUsername: apiData.receivedFeedback.from_username,
                  toUser: apiData.receivedFeedback.to_user,
                  rating: apiData.receivedFeedback.rating,
                  comment: apiData.receivedFeedback.comment,
                  createdAt: apiData.receivedFeedback.created_at,
                });
              }
            }
          } catch (e) {
            console.warn('Feedback API fetch notice:', e);
          }

          // Feedback is loaded exclusively by the authenticated server adapter,
          // which reads the canonical feedbacks table after verifying trade participation.
        }

        // Fetch dispute if any
        const { data: dispData } = await supabase
          .from('disputes')
          .select('*')
          .eq('trade_id', trade?.id)
          .maybeSingle();

        if (dispData) {
          setResolvedDispute(dispData);
        }
      }
    }

    if (trade?.id) {
      loadAuthAndTradeDetails();
    }
  }, [trade?.id, buyerId, sellerId, supabase]);

  // Dynamic payment countdown window (e.g. 30 mins from ad or trade configuration)
  const isCountdownActive = ['active', 'pending'].includes(tradeStatus);
  const paymentWindowMinutes = Number(trade?.payment_window_minutes || ad?.payment_window_minutes || 30);
  const createdAtTime = trade?.created_at ? new Date(trade.created_at).getTime() : Date.now();
  const dynamicExpiresDate = trade?.expiresAt || trade?.expires_at 
    ? new Date(trade?.expiresAt || trade?.expires_at) 
    : new Date(createdAtTime + paymentWindowMinutes * 60 * 1000);

  const markedPaidAt = trade?.marked_paid_at || trade?.paid_at || trade?.updated_at;
  const paidTimeMs = markedPaidAt ? new Date(markedPaidAt).getTime() : 0;
  const disputeEligibleTimeMs = paidTimeMs > 0 ? paidTimeMs + (3 * 60 * 60 * 1000) : Date.now() + (3 * 60 * 60 * 1000);
  const disputeTimeRemaining = useCountdown(tradeStatus === 'paid' && disputeEligibleTimeMs > 0 ? disputeEligibleTimeMs : 0);
  const isDisputeEligible = tradeStatus === 'paid' && (disputeEligibleTimeMs === 0 || disputeTimeRemaining.isFinished || disputeEligibleTimeMs <= Date.now());
  const paymentTimeRemaining = useCountdown(isCountdownActive ? dynamicExpiresDate.getTime() : 0);
  const isExpired = tradeStatus === 'expired' || (isCountdownActive && (paymentTimeRemaining.isFinished || (dynamicExpiresDate.getTime() > 0 && dynamicExpiresDate.getTime() <= Date.now())));
  const effectiveTradeStatus = isExpired ? 'expired' : tradeStatus;
  const showReopen = ['cancelled', 'expired'].includes(effectiveTradeStatus);

  const showFeedbackSection = effectiveTradeStatus === 'released' || effectiveTradeStatus === 'completed';
  const showActions = !isExpired && (
    ['active', 'paid', 'pending', 'buyer_marked_paid', 'payment_sent', 'disputed', 'dispute'].includes(tradeStatus) ||
    Boolean(resolvedDispute)
  );

  const getPositiveNumber = (...values: any[]): number => {
    for (const v of values) {
      if (v !== null && v !== undefined && v !== '') {
        const num = Number(v);
        if (!isNaN(num) && num > 0) return num;
      }
    }
    return 0;
  };

  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? trade?.coin ?? trade?.asset ?? 'USDT';
  const rawCryptoAmount = getPositiveNumber(trade?.crypto_amount, trade?.cryptoAmount, trade?.amount, trade?.amount_crypto);
  const rawRate = getPositiveNumber(trade?.rate, trade?.price, trade?.unit_price, trade?.fixed_rate, ad?.price, ad?.fixed_rate, ad?.fixedRate);
  let rawFiatAmount = getPositiveNumber(trade?.fiat_amount, trade?.fiatAmount, trade?.amount_usd, trade?.total_fiat, trade?.totalFiat, trade?.fiat);

  // If rate and crypto are present but fiat is 0
  if (rawFiatAmount <= 0 && rawCryptoAmount > 0 && rawRate > 0) {
    rawFiatAmount = rawCryptoAmount * rawRate;
  }
  // If fiat and rate are present but crypto is 0
  const effectiveCryptoAmount = rawCryptoAmount > 0 
    ? rawCryptoAmount 
    : (rawFiatAmount > 0 && rawRate > 0 ? rawFiatAmount / rawRate : 0);

  // If fiat is present and crypto is present but rate is 0
  const effectiveRate = rawRate > 0
    ? rawRate
    : (rawFiatAmount > 0 && effectiveCryptoAmount > 0 ? rawFiatAmount / effectiveCryptoAmount : 0);

  const effectiveFiatAmount = rawFiatAmount > 0 
    ? rawFiatAmount 
    : (effectiveCryptoAmount > 0 && effectiveRate > 0 ? effectiveCryptoAmount * effectiveRate : 0);

  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || trade?.fiat || ad?.fiat_symbol || ad?.fiat_currency || ad?.fiat || 'USD';

  const coinAmount = `${effectiveCryptoAmount < 0.01 && effectiveCryptoAmount > 0 ? effectiveCryptoAmount.toFixed(6) : effectiveCryptoAmount.toFixed(2)} ${coinSymbol}`;
  const priceFormatted = effectiveRate.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fiatAmount = effectiveFiatAmount.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const recordedEscrowFee = getPositiveNumber(trade?.escrow_fee, trade?.escrowFee);
  const escrowFeeCoin = recordedEscrowFee > 0
    ? `${recordedEscrowFee.toFixed(8)} ${coinSymbol}`
    : t('tradeDetailsPage.notRecorded');

  // Offer Tag and Ad Tags extraction
  const offerLabel = (ad?.offer_label || ad?.label || ad?.offer_tag || ad?.offerTag || trade?.offer_label || trade?.label || trade?.offer_tag || trade?.offerTag || '').trim();
  const rawAdTags = ad?.tags || ad?.ad_tags || ad?.offer_tags || trade?.tags || trade?.ad_tags || trade?.offer_tags || [];
  const adTags: string[] = (
    Array.isArray(rawAdTags) 
      ? rawAdTags 
      : typeof rawAdTags === 'string' 
        ? rawAdTags.split(',').map((s: string) => s.trim()) 
        : [rawAdTags]
  ).filter(Boolean).map((t: any) => String(t).replace(/^#/, ''));

  // Prioritize ad.id (e.g. per9yeeotd4k, 9sxin3zpbdgv) over generated system IDs
  const rawAdRef = ad?.id || ad?.public_ad_id || ad?.public_id || ad?.ad_id || trade?.ad_id || trade?.adId || trade?.public_ad_id || trade?.ad_public_id || trade?.ad;
  const publicAdDisplayId = rawAdRef ? (String(rawAdRef).replace(/^#/, '')) : '';
  const sellerOfferTerms = (
    ad?.terms || 
    ad?.terms_conditions || 
    ad?.termsAndConditions || 
    trade?.terms || 
    trade?.seller_terms || 
    trade?.terms_conditions || 
    ''
  ).trim();

  const publicTradeId = trade?.trade_id || trade?.public_id || trade?.tradeId || formatTradeId(trade?.id);
  const badgeStatusClass = statusColors[effectiveTradeStatus as keyof typeof statusColors] || statusColors.expired;
  const tradeStatusKeyByValue: Record<string, string> = {
    active: 'statusActive', pending: 'statusPending', paid: 'statusPaid', buyer_marked_paid: 'statusPaid',
    payment_sent: 'statusPaid', disputed: 'statusDisputed', dispute: 'statusDisputed', released: 'statusReleased', completed: 'statusCompleted',
    cancelled: 'statusCancelled', canceled: 'statusCancelled', expired: 'statusExpired',
  };
  const displayedTradeStatus = tradeStatusKeyByValue[effectiveTradeStatus]
    ? t('activeTrades.' + tradeStatusKeyByValue[effectiveTradeStatus])
    : effectiveTradeStatus;

  // Role-Aware Dispute Resolution Outcome Calculation
  const hasDispute = Boolean(
    resolvedDispute ||
    trade?.dispute ||
    trade?.disputed_at ||
    trade?.dispute_reason ||
    trade?.is_disputed ||
    tradeStatus === 'disputed' ||
    tradeStatus === 'dispute'
  );

  const isDisputeResolved = Boolean(
    hasDispute && (
      resolvedDispute?.status === 'resolved' ||
      resolvedDispute?.status === 'RESOLVED' ||
      ['released', 'completed', 'cancelled'].includes(effectiveTradeStatus)
    )
  );

  const resolvedWinnerId = resolvedDispute?.winner_id || (
    effectiveTradeStatus === 'released' || effectiveTradeStatus === 'completed'
      ? buyerId
      : effectiveTradeStatus === 'cancelled'
        ? sellerId
        : null
  );

  const isUserWinner = Boolean(
    isDisputeResolved &&
    resolvedWinnerId &&
    currentUser?.id &&
    String(resolvedWinnerId) === String(currentUser.id)
  );

  const isUserLoser = Boolean(
    isDisputeResolved &&
    resolvedWinnerId &&
    currentUser?.id &&
    String(resolvedWinnerId) !== String(currentUser.id) &&
    (currentUser.id === buyerId || currentUser.id === sellerId)
  );

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none bg-card text-card-foreground">
      <CardHeader className="p-4 border-b border-border/60">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-base font-bold text-foreground">{t('tradeDetailsPage.title')}</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-0.5">
              {t('tradeDetailsPage.ref')} {publicTradeId}
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('capitalize font-mono font-bold text-xs', badgeStatusClass)}>
            {displayedTradeStatus}
          </Badge>
        </div>
      </CardHeader>

      {/* Independent Scrollable Area for Trade Details */}
      <ScrollArea className="flex-1 min-h-0 p-4">
        <div className="space-y-4 pr-3">
          {/* Role-Aware Dispute Won Banner */}
          {isUserWinner && (
            <div className="rounded-xl border-2 border-emerald-500/50 bg-emerald-500/15 dark:bg-emerald-950/40 p-3.5 text-xs text-emerald-950 dark:text-emerald-100 shadow-sm space-y-1">
              <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300 text-sm">
                <Trophy className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{t('tradeDetailsPage.wonBannerTitle')}</span>
              </div>
              <p className="text-xs text-emerald-900/90 dark:text-emerald-200 leading-relaxed">
                {isBuying
                  ? t('tradeDetailsPage.wonBuyerMessage')
                  : t('tradeDetailsPage.wonSellerMessage')}
              </p>
            </div>
          )}

          {/* Role-Aware Dispute Lost Banner */}
          {isUserLoser && (
            <div className="rounded-xl border-2 border-rose-500/50 bg-rose-500/15 dark:bg-rose-950/40 p-3.5 text-xs text-rose-950 dark:text-rose-100 shadow-sm space-y-1">
              <div className="flex items-center gap-2 font-bold text-rose-700 dark:text-rose-300 text-sm">
                <XCircle className="h-4.5 w-4.5 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>{t('tradeDetailsPage.lostBannerTitle')}</span>
              </div>
              <p className="text-xs text-rose-900/90 dark:text-rose-200 leading-relaxed">
                {isBuying
                  ? t('tradeDetailsPage.lostBuyerMessage')
                  : t('tradeDetailsPage.lostSellerMessage')}
              </p>
            </div>
          )}

          {effectiveTradeStatus === 'paid' && !isDisputeResolved && (
            <div className={cn(
              "rounded-xl border p-3.5 text-xs font-medium space-y-1",
              isBuying
                ? "bg-blue-500/10 border-blue-500/30 text-blue-950 dark:text-blue-200"
                : "bg-amber-500/10 border-amber-500/30 text-amber-950 dark:text-amber-200"
            )}>
              <div className="font-bold flex items-center gap-1.5">
                <span>⚠️ {t('tradeDetailsPage.paidBannerTitle')}</span>
              </div>
              <p>
                {isBuying
                  ? t('tradeDetailsPage.buyerPaidMessage')
                  : t('tradeDetailsPage.sellerPaidMessage')}
              </p>
            </div>
          )}

          {/* Main Trade Values Card */}
          <div className="space-y-2.5 rounded-xl border border-border/60 p-4 bg-muted/20">
            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">{isBuying ? t('tradeDetailsPage.buying') : t('tradeDetailsPage.selling')}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold text-sm sm:text-base text-foreground tracking-tight">{coinAmount}</span>
                <CoinInsignia symbol={coinSymbol} className="h-4 w-4" />
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">{t('tradeDetailsPage.rate')}</span>
              <div className="flex items-center gap-1 text-xs sm:text-sm font-medium text-foreground">
                <span>1 {coinSymbol} = </span>
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">{priceFormatted}</span>
                <span>{fiatCurrency}</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">{t('tradeDetailsPage.escrowFee')}</span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight text-foreground">{escrowFeeCoin}</span>
                <CoinInsignia symbol={coinSymbol} className="h-3.5 w-3.5" />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground">{isBuying ? t('tradeDetailsPage.totalToPay') : t('tradeDetailsPage.totalToReceive')}</span>
              <div className="flex items-baseline gap-1 text-emerald-600 dark:text-emerald-400">
                <span className="text-base sm:text-xl font-bold font-[Arial,Helvetica,sans-serif] tabular-nums tracking-tight">
                  {fiatAmount}
                </span>
                <span className="text-xs sm:text-sm font-bold font-sans">
                  {fiatCurrency}
                </span>
              </div>
            </div>
          </div>

          {/* Offer Tag and Ad Tags (both clearly displayed) */}
          {(offerLabel || (adTags && adTags.length > 0)) && (
            <div className="flex flex-wrap items-center gap-1.5 py-0.5">
              {offerLabel && (
                <Badge
                  variant="secondary"
                  className="text-[11px] font-bold gap-1 px-2.5 py-1 bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/30"
                >
                  <Tag className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                  <span>{t('tradeDetailsPage.offerTagLabel')}: {offerLabel}</span>
                </Badge>
              )}
              {adTags.map((tag, idx) => (
                <Badge
                  key={idx}
                  variant="outline"
                  className="text-[11px] font-medium gap-1 px-2 py-0.5 bg-muted/40 text-muted-foreground border-border/60"
                >
                  <span>{t('tradeDetailsPage.adTag')}: #{tag}</span>
                </Badge>
              ))}
            </div>
          )}

          {/* Expired Trade Notice and Instructions */}
          {isExpired && (
            <div className="p-3.5 rounded-xl border-2 border-rose-500/40 bg-rose-500/10 text-rose-950 dark:text-rose-100 space-y-2 shadow-xs">
              <div className="flex items-center gap-1.5 font-bold text-rose-700 dark:text-rose-400 text-xs sm:text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{t('tradeDetailsPage.tradeExpired')}</span>
              </div>
              <p className="text-xs font-semibold leading-relaxed text-rose-900 dark:text-rose-200">
                {t('tradeDetailsPage.expiredWarning')}
              </p>
              <p className="text-xs text-rose-800/90 dark:text-rose-300/90 leading-relaxed">
                {t('tradeDetailsPage.expiredSupportMessage')}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button asChild size="sm" variant="default" className="text-xs bg-rose-600 hover:bg-rose-700 text-white font-semibold">
                  <Link href={`/ad/${publicAdDisplayId || ad?.id || trade?.ad_id || trade?.adId}`}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> {t('tradeDetailsPage.reopenTrade')}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="text-xs border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10">
                  <Link href="/support">
                    {t('tradeDetailsPage.contactSupport')}
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Buyer Safety Instructions Banner (Only when trade is actively ongoing) */}
          {!isExpired && isBuying && (tradeStatus === 'active' || tradeStatus === 'pending') && (
            <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200 text-xs space-y-1.5 shadow-xs">
              <div className="flex items-center gap-1.5 font-bold text-blue-700 dark:text-blue-300">
                <Shield className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <span>{t('tradeDetailsPage.buyerSafetyTitle')}</span>
              </div>
              <p className="leading-relaxed">
                {t('tradeDetailsPage.buyerSafetyMessage')}
              </p>
            </div>
          )}

          {/* Action Buttons (Only for non-expired active/paid states) */}
          {!isExpired && showActions && !isAdmin && (
            <div className="pt-1">
              <ActionButtons
                trade={trade}
                currentUserRole={currentUserRole}
                currentUserId={currentUser?.id}
                currentUsername={currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0]}
                counterpartId={opponentId}
                isExpired={isExpired}
                resolvedDispute={resolvedDispute}
              />
            </div>
          )}

          {/* High-Contrast Clear Payment Countdown in both Light & Dark themes */}
          {!isExpired && (tradeStatus === 'active' || tradeStatus === 'pending') && (
            <div className="flex items-center justify-between p-3.5 rounded-xl border-2 border-amber-500/50 dark:border-amber-400/60 bg-amber-500/15 dark:bg-slate-900/90 text-amber-950 dark:text-amber-100 shadow-sm">
              <div className="flex items-center gap-2">
                <Clock className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-xs sm:text-sm font-bold text-amber-900 dark:text-amber-200">{t('tradeDetailsPage.paymentCountdown')}</span>
              </div>
              <span className="font-mono font-extrabold text-amber-600 dark:text-amber-400 text-sm sm:text-base tabular-nums tracking-wider px-2 py-0.5 rounded-md bg-amber-500/10 dark:bg-amber-400/10 border border-amber-500/30 dark:border-amber-400/30">
                {`${String(paymentTimeRemaining.hours).padStart(2, '0')}:${String(paymentTimeRemaining.minutes).padStart(2, '0')}:${String(paymentTimeRemaining.seconds).padStart(2, '0')}`}
              </span>
            </div>
          )}

          {/* Report an Issue placed between Trade Details and Participants */}
          <div className="py-1">
            <ReportIssueDialog
              trade={trade}
              currentUserId={currentUser?.id || ''}
              currentUsername={currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'Trader'}
              counterpartId={opponentId}
            />
          </div>

          {/* Participants with Usernames */}
          <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              {t('tradeDetailsPage.participantsPayment')}
            </h4>
            <ParticipantRow
              label={t('tradeDetailsPage.buyer')}
              userId={buyerId}
              fallbackUsername={trade?.buyer?.username || trade?.buyer_username}
            />
            <ParticipantRow
              label={t('tradeDetailsPage.seller')}
              userId={sellerId}
              fallbackUsername={trade?.seller?.username || trade?.seller_username}
            />
            {(trade?.paymentMethod || trade?.payment_method) && (
              <DetailRow label={t('tradeDetailsPage.paymentMethod')} value={trade.paymentMethod || trade.payment_method} />
            )}
          </div>

          {/* Timestamps in User Timezone with GMT hover tooltip */}
          <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              {t('tradeDetailsPage.timeline')}
            </h4>
            <DetailRow
              label={t('tradeDetailsPage.created')}
              boldLabel
              value={
                <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground" title={formatUtcDateTime(trade?.createdAt || trade?.created_at)}>
                  {formatDateArial(trade?.createdAt || trade?.created_at, timezone)}
                </span>
              }
            />
            {(trade?.paidAt || trade?.paid_at) && (
              <DetailRow
                label={t('tradeDetailsPage.markedPaid')}
                boldLabel
                value={
                  <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground" title={formatUtcDateTime(trade.paidAt || trade.paid_at)}>
                    {formatDateArial(trade.paidAt || trade.paid_at, timezone)}
                  </span>
                }
              />
            )}
            {(trade?.releasedAt || trade?.released_at) && (
              <DetailRow
                label={t('tradeDetailsPage.released')}
                boldLabel
                value={
                  <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground" title={formatUtcDateTime(trade.releasedAt || trade.released_at)}>
                    {formatDateArial(trade.releasedAt || trade.released_at, timezone)}
                  </span>
                }
              />
            )}
            {(isExpired || tradeStatus === 'expired') && (
              <DetailRow
                label={t('tradeDetailsPage.expired')}
                boldLabel
                value={
                  <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-rose-600 dark:text-rose-400" title={formatUtcDateTime(trade?.expires_at || dynamicExpiresDate)}>
                    {formatDateArial(trade?.expires_at || dynamicExpiresDate, timezone)}
                  </span>
                }
              />
            )}
          </div>

          {isDisputeResolved && (
            <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                {t('tradeDetailsPage.disputeResolution')}
              </h4>
              <DetailRow
                label={t('tradeDetailsPage.awardedTo')}
                boldLabel
                value={resolvedWinnerId === buyerId ? t('tradeDetailsPage.buyer') : t('tradeDetailsPage.seller')}
                valueClass="font-bold text-primary"
              />
              <DetailRow
                label={t('tradeDetailsPage.yourResult')}
                boldLabel
                value={
                  isUserWinner ? (
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <Trophy className="h-3.5 w-3.5" /> {t('tradeDetailsPage.wonDispute')}
                    </span>
                  ) : isUserLoser ? (
                    <span className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                      <XCircle className="h-3.5 w-3.5" /> {t('tradeDetailsPage.lostDispute')}
                    </span>
                  ) : (
                    <span className="capitalize">{resolvedWinnerId === buyerId ? t('tradeDetailsPage.awardedToBuyer') : t('tradeDetailsPage.awardedToSeller')}</span>
                  )
                }
              />
              <DetailRow
                label={t('tradeDetailsPage.outcome')}
                value={<span className="capitalize">{effectiveTradeStatus === 'released' || effectiveTradeStatus === 'completed' ? t('tradeDetailsPage.releasedToBuyer') : t('tradeDetailsPage.returnedToSeller')}</span>}
              />
              {(resolvedDispute?.resolution_reason || resolvedDispute?.resolution_note || resolvedDispute?.resolution) && (
                <DetailRow
                  label={t('tradeDetailsPage.decisionNotes')}
                  value={resolvedDispute.resolution_reason || resolvedDispute.resolution_note || resolvedDispute.resolution}
                />
              )}
              {(resolvedDispute?.resolved_at || resolvedDispute?.resolvedAt) && (
                <DetailRow
                  label={t('tradeDetailsPage.resolvedAt')}
                  boldLabel
                  value={
                    <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground" title={formatUtcDateTime(resolvedDispute.resolved_at || resolvedDispute.resolvedAt)}>
                      {formatDateArial(resolvedDispute.resolved_at || resolvedDispute.resolvedAt, timezone)}
                    </span>
                  }
                />
              )}
            </div>
          )}

          {/* Ad Reference & Offer Terms */}
          <div className="space-y-2 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-1">
              {t('tradeDetailsPage.offerTermsAdInfo')}
            </h4>
            {publicAdDisplayId ? (
              <DetailRow
                label={t('tradeDetailsPage.adId')}
                boldLabel
                value={`#${publicAdDisplayId}`}
                isLink={true}
                href={`/ad/${publicAdDisplayId}`}
              />
            ) : (
              <DetailRow
                label={t('tradeDetailsPage.adId')}
                boldLabel
                value="—"
                isLink={false}
              />
            )}
            {offerLabel && (
              <DetailRow
                label={t('tradeDetailsPage.offerTag')}
                boldLabel
                value={
                  <Badge variant="secondary" className="text-[11px] font-bold px-2 py-0.5 bg-amber-500/15 text-amber-800 dark:text-amber-200 border border-amber-500/30">
                    {offerLabel}
                  </Badge>
                }
              />
            )}
            {adTags && adTags.length > 0 && (
              <DetailRow
                label={t('tradeDetailsPage.adTags')}
                boldLabel
                value={
                  <div className="flex flex-wrap gap-1">
                    {adTags.map((tag, idx) => (
                      <Badge key={idx} variant="outline" className="text-[10px] px-1.5 py-0">
                        #{tag}
                      </Badge>
                    ))}
                  </div>
                }
              />
            )}
            <div className="pt-1 border-t border-border/40">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                <span>{t('tradeDetailsPage.sellerTermsLabel')}</span>
              </p>
              <div className="text-xs p-3 bg-muted/40 dark:bg-muted/20 rounded-xl text-foreground whitespace-pre-wrap leading-relaxed border border-border/40">
                {sellerOfferTerms || t('tradeDetailsPage.sellerTermsFallback')}
              </div>
            </div>
          </div>

          {/* Reopen Action for cancelled trades */}
          {showReopen && (
            <Button asChild variant="outline" className="w-full text-xs font-bold">
              <Link href={`/ad/${trade.adId || trade.ad_id || publicAdDisplayId}`}>
                <RefreshCw className="mr-2 h-4 w-4" /> {t('tradeDetailsPage.reopenTrade')}
              </Link>
            </Button>
          )}

          {/* Feedback Form */}
          {showFeedbackSection && (
            <FeedbackForm
              trade={trade}
              existingFeedback={existingFeedback}
              receivedFeedback={receivedFeedback}
              onFeedbackSaved={(fb) => setExistingFeedback(fb)}
              currentUserId={currentUser?.id}
              currentUsername={currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0]}
              counterpartId={opponentId}
              counterpartUsername={opponentUsername}
            />
          )}

          {isAdmin && <AdminTradeActions trade={trade} adminUserId={currentUser?.id} />}
        </div>
      </ScrollArea>
    </Card>
  );
}

export default TradeDetails;
