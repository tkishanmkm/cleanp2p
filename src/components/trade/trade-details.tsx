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
  adminReleaseFunds,
  resolveDispute
} from '@/lib/admin-actions';
import {
  markTradeAsPaid,
  releaseFundsFromEscrow,
  cancelTrade,
  disputeTrade
} from '@/lib/wallet';
import { insertPaxonesSystemMessage, formatCryptoAmount } from '@/lib/trade-system-messages';
import { cn, toDate } from '@/lib/utils';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import type { Trade, P2PAd, Dispute, Feedback } from '@/lib/types';
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
  Tag
} from 'lucide-react';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import AdminActionDialog, { AdminActionType } from '@/components/admin/admin-action-dialog';

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
  expired: 'border-muted-foreground/40 text-muted-foreground bg-muted'
};

const formatDateArial = (dateVal: any): string => {
  const d = toDate(dateVal);
  if (!d) return 'N/A';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month}/${day}/${year}, ${hours}:${minutes} ${ampm}`;
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
    <p className={boldLabel ? "font-bold text-foreground" : "text-muted-foreground"}>{label}</p>
    {isLink ? (
      <Link href={href} className="font-mono font-bold text-primary hover:underline">
        {value}
      </Link>
    ) : (
      <p className={cn('font-medium text-foreground text-right', valueClass)}>{value}</p>
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
  const [displayUsername, setDisplayUsername] = useState<string>(fallbackUsername || 'Trader');
  const [merchantTier, setMerchantTier] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      if (fallbackUsername) setDisplayUsername(fallbackUsername);
      return;
    }

    const fetchUsername = async () => {
      // If it's a UUID, fetch profile
      if (userId.includes('-')) {
        const { data } = await supabase
          .from('profiles')
          .select('username, merchant_tier')
          .eq('id', userId)
          .maybeSingle();

        if (data?.username) {
          setDisplayUsername(data.username);
        }
        if (data?.merchant_tier) {
          setMerchantTier(data.merchant_tier);
        }
        return;
      }
      setDisplayUsername(fallbackUsername || userId);
    };

    fetchUsername();
  }, [userId, fallbackUsername, supabase]);

  return (
    <div className="flex justify-between items-center text-xs sm:text-sm py-1.5 border-b border-border/40">
      <p className="font-bold text-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <Link
          href={`/users/${displayUsername}`}
          className="font-bold text-primary hover:underline flex items-center gap-1.5"
        >
          <span>@{displayUsername}</span>
        </Link>
        <MerchantBadge tier={merchantTier} size="sm" />
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
      toast({ variant: 'destructive', title: 'Select an Issue', description: 'Please choose an issue category.' });
      return;
    }
    if (!details.trim()) {
      toast({ variant: 'destructive', title: 'Details Required', description: 'Please describe what occurred.' });
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
            message: `@${currentUsername} filed an issue report for trade ${formatTradeId(trade.id)}: ${selectedIssue}`,
            link: `/trade/${trade.id}`,
            is_read: false,
            created_at: new Date().toISOString()
          }
        ]);
      }

      toast({
        title: 'Issue Reported',
        description: 'Our moderation team has received your report and logged it to the trade room.'
      });
      setHasUserReported(true);
      setIsOpen(false);
      setSelectedIssue('');
      setDetails('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Report Failed', description: err.message });
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
        <span>Reported</span>
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
          <span>Report an Issue</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Report an Issue / Fraud
          </DialogTitle>
          <DialogDescription className="text-xs">
            Submit a formal report to Pax moderation. This will be recorded in the trade audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Select Issue Category (8 Options)</Label>
            <Select value={selectedIssue} onValueChange={setSelectedIssue}>
              <SelectTrigger className="w-full text-xs">
                <SelectValue placeholder="Choose the issue type..." />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_OPTIONS.map((opt, idx) => (
                  <SelectItem key={idx} value={opt} className="text-xs">
                    {idx + 1}. {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-bold">Additional Details & Evidence</Label>
            <Textarea
              placeholder="Provide specific transaction references, timestamps, or description..."
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="text-xs min-h-[90px]"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleSubmitIssue}
            disabled={isSubmitting || !selectedIssue || !details.trim()}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            Submit Report
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
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('Payment Issue');
  const [explanation, setExplanation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!explanation.trim()) {
      toast({ variant: 'destructive', title: 'Explanation required', description: 'Please provide dispute details.' });
      return;
    }
    setIsSubmitting(true);
    try {
      await disputeTrade(trade, reason, explanation, currentUserId, currentUsername);
      toast({ title: 'Dispute Opened', description: 'A moderator has been assigned to this trade.' });
      setIsOpen(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Dispute Failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="w-full text-xs font-bold" disabled={disabled}>
          <ShieldAlert className="mr-2 h-4 w-4" /> Open Official Dispute
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open Official Dispute</DialogTitle>
          <DialogDescription>
            An escrow mediator will join the chat to review payment proofs and resolve this trade.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className="text-xs">Dispute Reason</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="text-xs mt-1" />
          </div>
          <div>
            <Label className="text-xs">Explanation</Label>
            <Textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Explain the situation in detail..."
              className="text-xs mt-1"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ActionButtons = ({
  trade,
  currentUserRole,
  currentUserId,
  currentUsername,
  counterpartId
}: {
  trade: Trade | any;
  currentUserRole: 'buy' | 'sell';
  currentUserId?: string;
  currentUsername?: string;
  counterpartId?: string;
}) => {
  const { toast } = useToast();
  const tradeStatus = (trade?.status || '').toLowerCase();
  const isBuyer = currentUserRole === 'buy';

  const [didNotPayChecked, setDidNotPayChecked] = useState(false);
  const [isPaidConfirmOpen, setIsPaidConfirmOpen] = useState(false);
  const [isReleaseConfirmOpen, setIsReleaseConfirmOpen] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [is2faActive, setIs2faActive] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  useEffect(() => {
    if (isReleaseConfirmOpen && currentUserId) {
      const check2FA = async () => {
        try {
          const supabase = createClient();
          const { data } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled')
            .eq('id', currentUserId)
            .maybeSingle();
          if (data) {
            setIs2faActive(Boolean(data.is_2fa_enabled || data.is_mfa_enabled));
          }
        } catch (err) {
          console.warn('Failed to check 2FA status:', err);
        }
      };
      check2FA();
    }
  }, [isReleaseConfirmOpen, currentUserId]);

  const canMarkPaid = isBuyer && (tradeStatus === 'active' || tradeStatus === 'pending');
  // CRITICAL ESCROW RULE: The Release Escrow button MUST strictly render ONLY when trade status is PAID / buyer_marked_paid
  const canRelease = !isBuyer && (tradeStatus === 'paid' || tradeStatus === 'buyer_marked_paid' || tradeStatus === 'payment_sent');
  const canBuyerCancel = isBuyer && (tradeStatus === 'active' || tradeStatus === 'pending');

  const handleMarkAsPaid = async () => {
    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MARK_PAID' })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to mark as paid');

      toast({ title: 'Trade Marked as Paid', description: 'The seller has been notified to verify payment and release coin.' });
      setIsPaidConfirmOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleReleaseCrypto = async () => {
    if (is2faActive && (!totpCode || totpCode.trim().length < 4)) {
      toast({
        variant: 'destructive',
        title: '2FA Code Required',
        description: 'Please enter your 4-8 digit authenticator OTP code to release escrow.',
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
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to release escrow');

      toast({ title: 'Escrow Released', description: 'Funds successfully transferred to buyer wallet.' });
      setIsReleaseConfirmOpen(false);
      setTotpCode('');
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleCancelTrade = async () => {
    setIsSubmittingAction(true);
    try {
      const res = await fetch(`/api/trades/${trade.id}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'CANCEL_TRADE', reason: 'Cancelled by buyer (confirmed no payment sent)' })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to cancel trade');

      toast({ title: 'Trade Cancelled', description: 'Escrow deposit returned to seller.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
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
              <Button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold">
                I Have Paid
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Payment Sent</AlertDialogTitle>
                <AlertDialogDescription>
                  Ensure you have transferred exact fiat to the seller&apos;s payment account before confirming.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Go Back</AlertDialogCancel>
                <AlertDialogAction onClick={handleMarkAsPaid} disabled={isSubmittingAction}>
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Confirm Paid
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
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold py-2.5 text-sm shadow-md">
                Release Escrow
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle>Release Escrow Coin?</AlertDialogTitle>
                <AlertDialogDescription>
                  WARNING: This action is irreversible. Only release after verifying full payment in your bank/wallet account.
                </AlertDialogDescription>
              </AlertDialogHeader>

              {is2faActive && (
                <div className="space-y-2 py-2">
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <Label htmlFor="release-totp" className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <Shield className="h-4 w-4" />
                      Two-Factor Authentication (2FA) Required
                    </Label>
                    <Input
                      id="release-totp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={8}
                      placeholder="Enter 4-8 digit authenticator OTP"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value)}
                      className="font-mono text-center tracking-widest bg-background"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Enter the one-time password generated by your authenticator app to authorize this release.
                    </p>
                  </div>
                </div>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReleaseCrypto}
                  disabled={isSubmittingAction || (is2faActive && totpCode.trim().length < 4)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Confirm & Release Escrow
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canBuyerCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full text-xs text-destructive hover:bg-destructive/10">
                Cancel Trade
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="sm:max-w-md">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base text-destructive flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Are you sure you want to cancel this trade?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs space-y-2 text-foreground/80">
                  <p>
                    Only confirm cancellation if you have not made the required payment. False cancellation information may affect dispute resolution and account status.
                  </p>
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
                    I confirm that I have not sent payment
                  </Label>
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep Trade</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleCancelTrade}
                  disabled={!didNotPayChecked || isSubmittingAction}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isSubmittingAction && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
                  Confirm Cancellation
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {tradeStatus === 'paid' && currentUserId && (
          <OpenDisputeDialog
            trade={trade}
            currentUserId={currentUserId}
            currentUsername={currentUsername || 'user'}
            disabled={false}
          />
        )}
      </div>
    </div>
  );
};

const feedbackSchema = z.object({
  rating: z.enum(['positive', 'negative'], { required_error: 'Please select a rating.' }),
  comment: z.string().min(1, 'Comment is required.').max(500, 'Comment cannot exceed 500 characters.')
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

function FeedbackForm({
  trade,
  existingFeedback,
  onFeedbackSaved,
  currentUserId,
  currentUsername,
  counterpartId
}: {
  trade: Trade | any;
  existingFeedback?: Feedback;
  onFeedbackSaved?: (fb: Feedback) => void;
  currentUserId?: string;
  currentUsername?: string;
  counterpartId?: string;
}) {
  const supabase = createClient();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

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
      toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to leave feedback.' });
      return;
    }

    const opponentId = counterpartId || (currentUserId === (trade.buyerId || trade.buyer_id) ? (trade.sellerId || trade.seller_id) : (trade.buyerId || trade.buyer_id));
    const publicTradeId = trade.tradeId || formatTradeId(trade.id);

    try {
      let savedFbRecord: any = null;

      // 1. First attempt via secure API route (handles RLS bypass, profiles update, chat system message)
      try {
        const res = await fetch('/api/trade/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tradeId: trade.id,
            rating: values.rating,
            comment: values.comment,
            counterpartId: opponentId,
          }),
        });

        if (res.ok) {
          const apiData = await res.json();
          if (apiData.feedback) {
            savedFbRecord = apiData.feedback;
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.warn('API feedback notice:', errData?.error);
        }
      } catch (apiErr) {
        console.warn('API feedback error:', apiErr);
      }

      // 2. Fallback to direct supabase client if needed
      if (!savedFbRecord) {
        if (existingFeedback?.id) {
          const { data: updatedData, error: updateErr } = await supabase
            .from('feedback')
            .update({
              rating: values.rating,
              is_positive: values.rating === 'positive',
              comment: values.comment,
              updated_at: new Date().toISOString()
            })
            .eq('id', existingFeedback.id)
            .select()
            .maybeSingle();
          if (updateErr) throw updateErr;
          savedFbRecord = updatedData;
        } else {
          const { data: insertedData, error: insertErr } = await supabase.from('feedback').insert([
            {
              trade_id: trade.id,
              from_user: currentUserId,
              from_username: currentUsername || 'Trader',
              to_user: opponentId,
              rating: values.rating,
              is_positive: values.rating === 'positive',
              comment: values.comment,
              created_at: new Date().toISOString()
            }
          ]).select().maybeSingle();
          if (insertErr) throw insertErr;
          savedFbRecord = insertedData;
        }

        // Adjust counts in profiles table
        const { data: allFb } = await supabase
          .from('feedback')
          .select('rating, is_positive')
          .eq('to_user', opponentId);

        if (allFb) {
          const positiveCount = allFb.filter((f) => f.is_positive === true || f.is_positive === 'true' || f.rating === 'positive').length;
          const negativeCount = allFb.filter((f) => f.is_positive === false || f.is_positive === 'false' || f.rating === 'negative').length;
          const total = positiveCount + negativeCount;
          const score = total > 0 ? Math.round((positiveCount / total) * 100) : 100;

          await supabase
            .from('profiles')
            .update({
              positive_feedback: positiveCount,
              negative_feedback: negativeCount,
              feedback_score: score
            })
            .eq('id', opponentId);
        }

        // Add official Paxones system message in trade_messages
        await insertPaxonesSystemMessage(supabase, {
          tradeId: trade.id,
          type: values.rating === 'positive' ? 'POSITIVE_FEEDBACK' : 'NEGATIVE_FEEDBACK',
          openerUsername: currentUsername || 'Trader',
          feedbackComment: values.comment
        });

        // Add notification for opponent
        await supabase.from('notifications').insert([
          {
            user_id: opponentId,
            message: `@${currentUsername || 'Trader'} left you ${values.rating} feedback for trade #${publicTradeId}.`,
            link: `/trade/${trade.id}`,
            is_read: false,
            created_at: new Date().toISOString()
          }
        ]);
      }

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
        title: existingFeedback ? 'Feedback Updated' : 'Feedback Submitted',
        description: 'Your rating and review has been recorded.'
      });
      setIsEditing(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Failed to submit feedback: ${error.message}` });
    }
  }

  if (existingFeedback && !isEditing) {
    const isPositive = existingFeedback.rating === 'positive';
    return (
      <div className="space-y-3 pt-3 border-t border-border/60">
        <div className="flex items-center justify-between">
          <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
            <ThumbsUp className="h-3.5 w-3.5 text-primary" /> You have submitted feedback
          </h4>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="h-7 text-xs font-semibold px-2.5"
          >
            Edit Feedback
          </Button>
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
              {isPositive ? 'Positive Feedback' : 'Negative Feedback'}
            </span>
            <span className="text-[10px] opacity-75 font-mono">
              {existingFeedback.createdAt ? toDate(existingFeedback.createdAt)?.toLocaleDateString() : 'Recorded'}
            </span>
          </div>
          {existingFeedback.comment && (
            <p className="text-xs italic leading-relaxed pt-1 whitespace-pre-wrap">&quot;{existingFeedback.comment}&quot;</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3 pt-3 border-t border-border/60">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-xs text-foreground">
            {existingFeedback ? 'Edit Your Feedback' : 'Leave Feedback for Partner'}
          </h4>
          {existingFeedback && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsEditing(false)}
              className="h-6 text-[11px] px-2 text-muted-foreground"
            >
              Cancel
            </Button>
          )}
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
                    <span>Positive</span>
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
                    <span>Negative</span>
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
                  placeholder="Share details about your trading experience..."
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
          {existingFeedback ? 'Update Feedback' : 'Submit Feedback'}
        </Button>
      </form>
    </Form>
  );
}

function AdminTradeActions({ trade, adminUserId }: { trade: Trade | any; adminUserId?: string }) {
  const supabase = createClient();
  const { toast } = useToast();
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

        const dummyDispute: Dispute = dispute || {
          id: `disp_${trade.id}`,
          tradeId: trade.id,
          openedBy: trade.buyerId || trade.buyer_id,
          reason: 'Admin resolution',
          explanation: reason,
          status: 'open',
          createdAt: new Date().toISOString()
        };

        const winnerId = action === 'award_buyer' ? (trade.buyerId || trade.buyer_id) : (trade.sellerId || trade.seller_id);
        await resolveDispute(supabase, trade, dummyDispute, winnerId, adminUserId, trade.fiatAmountInUSD || trade.fiat_amount_usd || 0);
      }
      toast({ title: 'Admin Action Successful', description: 'The trade has been updated.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Admin Action Failed', description: e.message });
    } finally {
      setDialogState({ open: false, action: null });
    }
  };

  const tradeStatus = (trade?.status || '').toLowerCase();

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
            Admin Escrow Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-1.5 p-3 pt-0">
          {tradeStatus === 'disputed' || tradeStatus === 'dispute' ? (
            <>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'award_buyer' })}>
                <Gavel className="mr-1 h-3.5 w-3.5" /> Award Buyer
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'award_seller' })}>
                <Gavel className="mr-1 h-3.5 w-3.5" /> Award Seller
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'cancel' })}>
                Cancel Trade
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => setDialogState({ open: true, action: 'paid' })}>
                Mark Paid
              </Button>
              <Button size="sm" variant="outline" className="col-span-2 text-xs" onClick={() => setDialogState({ open: true, action: 'release' })}>
                Release Funds
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
  const isBuying = currentUserRole === 'buy';
  const tradeStatus = (trade?.status || 'active').toLowerCase();
  const showReopen = ['cancelled', 'expired'].includes(tradeStatus);
  const { isAdmin } = useAdminStatus();

  const [currentUser, setCurrentUser] = useState<any>(null);
  const [existingFeedback, setExistingFeedback] = useState<Feedback | undefined>(undefined);
  const [resolvedDispute, setResolvedDispute] = useState<any>(null);

  const buyerId = trade?.buyer_id || trade?.buyerId;
  const sellerId = trade?.seller_id || trade?.sellerId;
  const opponentId = currentUser?.id === buyerId ? sellerId : buyerId;

  useEffect(() => {
    async function loadAuthAndTradeDetails() {
      const {
        data: { user }
      } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);

        // Fetch existing feedback for this specific trade
        const oppId = user.id === buyerId ? sellerId : buyerId;
        if (trade?.id) {
          try {
            const apiRes = await fetch(`/api/trade/feedback?tradeId=${trade.id}&userId=${user.id}`);
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
                return;
              }
            }
          } catch (e) {
            console.warn('Feedback API fetch notice:', e);
          }

          const { data: tradeFb } = await supabase
            .from('feedback')
            .select('*')
            .eq('trade_id', trade.id)
            .eq('from_user', user.id)
            .maybeSingle();

          if (tradeFb) {
            setExistingFeedback({
              id: tradeFb.id,
              tradeId: tradeFb.trade_id,
              fromUser: tradeFb.from_user,
              fromUsername: tradeFb.from_username,
              toUser: tradeFb.to_user,
              rating: tradeFb.rating,
              comment: tradeFb.comment,
              createdAt: tradeFb.created_at
            });
          } else if (oppId) {
            const { data: fbData } = await supabase
              .from('feedback')
              .select('*')
              .eq('from_user', user.id)
              .eq('to_user', oppId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (fbData) {
              setExistingFeedback({
                id: fbData.id,
                tradeId: fbData.trade_id,
                fromUser: fbData.from_user,
                fromUsername: fbData.from_username,
                toUser: fbData.to_user,
                rating: fbData.rating,
                comment: fbData.comment,
                createdAt: fbData.created_at
              });
            }
          }
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
  const paymentWindowMinutes = Number(trade?.payment_window_minutes || ad?.payment_window_minutes || 30);
  const createdAtTime = trade?.created_at ? new Date(trade.created_at).getTime() : Date.now();
  const dynamicExpiresDate = trade?.expiresAt || trade?.expires_at 
    ? new Date(trade?.expiresAt || trade?.expires_at) 
    : new Date(createdAtTime + paymentWindowMinutes * 60 * 1000);

  const isCountdownActive = tradeStatus === 'active' || tradeStatus === 'pending';
  const paymentTimeRemaining = useCountdown(isCountdownActive ? dynamicExpiresDate : new Date(0));

  useEffect(() => {
    let isMounted = true;
    const expireTrade = async () => {
      if (isCountdownActive && paymentTimeRemaining.isFinished && trade?.id) {
        try {
          await fetch(`/api/trades/${trade.id}/actions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'EXPIRE_TRADE' })
          });
        } catch (e) {
          console.error('Failed to auto-expire trade:', e);
        }
      }
    };
    expireTrade();
    return () => {
      isMounted = false;
    };
  }, [paymentTimeRemaining.isFinished, isCountdownActive, trade?.id]);

  const showFeedbackSection = tradeStatus === 'released' || tradeStatus === 'completed';
  const showActions = ['active', 'paid', 'pending', 'buyer_marked_paid', 'payment_sent'].includes(tradeStatus);

  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? 'USDT';
  const rawCryptoAmount = Number(trade?.crypto_amount ?? trade?.cryptoAmount ?? trade?.amount ?? 0);
  const rawRate = Number(trade?.rate ?? trade?.price ?? ad?.price ?? 0);
  const rawEscrowFee = Number(trade?.escrow_fee ?? trade?.escrowFee ?? (rawCryptoAmount * 0.015));
  
  // Robust fiat amount computation: use total_fiat / fiat_amount, or calculate crypto * rate if valid
  const rawFiatAmount = Number(
    trade?.total_fiat ?? 
    trade?.totalFiat ?? 
    trade?.fiat_amount ?? 
    trade?.fiatAmount ?? 
    trade?.amount_usd ?? 
    (rawCryptoAmount > 0 && rawRate > 0 ? rawCryptoAmount * rawRate : 0)
  );
  
  // If fiat amount was provided directly (e.g. 8400 INR) but crypto amount is missing or miscalculated, derive crypto amount
  const effectiveCryptoAmount = rawCryptoAmount > 0 
    ? rawCryptoAmount 
    : (rawFiatAmount > 0 && rawRate > 0 ? rawFiatAmount / rawRate : 0);

  const effectiveFiatAmount = rawFiatAmount > 0 
    ? rawFiatAmount 
    : (effectiveCryptoAmount > 0 && rawRate > 0 ? effectiveCryptoAmount * rawRate : 0);

  const fiatCurrency = trade?.fiat_currency || trade?.fiatCurrency || trade?.fiat_symbol || ad?.fiat_symbol || 'INR';

  const coinAmount = `${effectiveCryptoAmount.toFixed(2)} ${coinSymbol}`;
  const priceFormatted = rawRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fiatAmount = effectiveFiatAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const escrowFeeCoin = `${(effectiveCryptoAmount * 0.015).toFixed(2)} ${coinSymbol}`;

  const offerTags: string[] = (ad?.tags && ad.tags.length > 0) ? ad.tags : ((ad?.offer_tags && ad.offer_tags.length > 0) ? ad.offer_tags : []);

  const publicTradeId = trade?.tradeId || formatTradeId(trade?.id);
  const badgeStatusClass = statusColors[tradeStatus as keyof typeof statusColors] || 'border-primary/40 text-primary bg-primary/10';

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none bg-card text-card-foreground">
      <CardHeader className="p-4 border-b border-border/60">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Trade Details</CardTitle>
            <CardDescription className="text-xs font-mono text-muted-foreground mt-0.5">
              Ref: {publicTradeId}
            </CardDescription>
          </div>
          <Badge variant="outline" className={cn('capitalize font-mono font-bold text-xs', badgeStatusClass)}>
            {trade?.status || 'unknown'}
          </Badge>
        </div>
      </CardHeader>

      {/* Independent Scrollable Area for Trade Details */}
      <ScrollArea className="flex-1 min-h-0 p-4">
        <div className="space-y-4 pr-3">
          {/* Main Trade Values Card */}
          <div className="space-y-2.5 rounded-xl border border-border/60 p-4 bg-muted/20">
            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">{isBuying ? 'You are buying' : 'You are selling'}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold text-sm sm:text-base text-foreground tracking-tight">{coinAmount}</span>
                <CoinInsignia symbol={coinSymbol} className="h-4 w-4" />
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">Rate</span>
              <div className="flex items-center gap-1 text-xs sm:text-sm font-medium text-foreground">
                <span>1 {coinSymbol} = </span>
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">{priceFormatted}</span>
                <span>{fiatCurrency}</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="font-bold text-foreground">Escrow Fee (1.5%)</span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight text-foreground">{escrowFeeCoin}</span>
                <CoinInsignia symbol={coinSymbol} className="h-3.5 w-3.5" />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2">
              <span className="text-xs sm:text-sm font-semibold text-foreground">{isBuying ? 'Total to Pay' : 'Total to Receive'}</span>
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

          {/* Offer Tags */}
          {offerTags && offerTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 py-0.5">
              {offerTags.map((tag, idx) => (
                <Badge
                  key={idx}
                  variant="secondary"
                  className="text-[11px] font-medium gap-1 px-2 py-0.5 bg-primary/10 text-primary border-primary/20"
                >
                  <Tag className="h-3 w-3" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {showActions && !isAdmin && (
            <div className="pt-1">
              <ActionButtons
                trade={trade}
                currentUserRole={currentUserRole}
                currentUserId={currentUser?.id}
                currentUsername={currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0]}
                counterpartId={opponentId}
              />
            </div>
          )}

          {(tradeStatus === 'active' || tradeStatus === 'pending') && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-xs font-semibold">Payment Countdown:</span>
              </div>
              <span className="font-mono font-bold text-destructive text-sm">
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
              Participants & Payment
            </h4>
            <ParticipantRow
              label="Buyer"
              userId={buyerId}
              fallbackUsername={trade?.buyer?.username || trade?.buyer_username || (buyerId ? `user_${buyerId.substring(0, 6)}` : 'forcehui4819')}
            />
            <ParticipantRow
              label="Seller"
              userId={sellerId}
              fallbackUsername={trade?.seller?.username || trade?.seller_username || (sellerId ? `user_${sellerId.substring(0, 6)}` : 'Seller')}
            />
            {(trade?.paymentMethod || trade?.payment_method) && (
              <DetailRow label="Payment Method" value={trade.paymentMethod || trade.payment_method} />
            )}
          </div>

          {/* Timestamps */}
          <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              Timeline
            </h4>
            <DetailRow
              label="Created"
              boldLabel
              value={
                <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground">
                  {formatDateArial(trade?.createdAt || trade?.created_at)}
                </span>
              }
            />
            {(trade?.paidAt || trade?.paid_at) && (
              <DetailRow
                label="Marked Paid"
                boldLabel
                value={
                  <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground">
                    {formatDateArial(trade.paidAt || trade.paid_at)}
                  </span>
                }
              />
            )}
            {(trade?.releasedAt || trade?.released_at) && (
              <DetailRow
                label="Released"
                boldLabel
                value={
                  <span className="font-[Arial,Helvetica,sans-serif] text-xs font-medium text-foreground">
                    {formatDateArial(trade.releasedAt || trade.released_at)}
                  </span>
                }
              />
            )}
          </div>

          {resolvedDispute && (
            <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
              <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
                Dispute Resolution
              </h4>
              <DetailRow
                label="Awarded To"
                boldLabel
                value={resolvedDispute.winner_id === buyerId ? 'Buyer' : 'Seller'}
                valueClass="font-bold text-primary"
              />
              <DetailRow
                label="Outcome"
                value={<span className="capitalize">{tradeStatus === 'released' ? 'Released to Buyer' : 'Returned to Seller'}</span>}
              />
            </div>
          )}

          {/* Ad Reference */}
          <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
              Offer Terms
            </h4>
            {(ad?.publicAdId || ad?.ad_id || trade?.adId || trade?.ad_id) && (
              <DetailRow
                label="Ad Reference"
                boldLabel
                value={ad?.publicAdId || ad?.ad_id || trade?.adId || trade?.ad_id}
                isLink
                href={`/ad/${ad?.id || trade?.adId || trade?.ad_id}`}
              />
            )}
            {(ad?.terms || trade?.terms || trade?.seller_terms) && (
              <div className="pt-2">
                <p className="text-xs text-muted-foreground mb-1">Seller Terms:</p>
                <div className="text-xs p-2.5 bg-muted/40 rounded-lg text-foreground whitespace-pre-wrap">
                  {ad?.terms || trade?.terms || trade?.seller_terms}
                </div>
              </div>
            )}
          </div>

          {/* Reopen Action for cancelled trades */}
          {showReopen && (
            <Button asChild variant="outline" className="w-full text-xs font-bold">
              <Link href={`/ad/${trade.adId || trade.ad_id}`}>
                <RefreshCw className="mr-2 h-4 w-4" /> Start New Trade With Offer
              </Link>
            </Button>
          )}

          {/* Feedback Form */}
          {showFeedbackSection && (
            <FeedbackForm
              trade={trade}
              existingFeedback={existingFeedback}
              onFeedbackSaved={(fb) => setExistingFeedback(fb)}
              currentUserId={currentUser?.id}
              currentUsername={currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0]}
              counterpartId={opponentId}
            />
          )}

          {isAdmin && <AdminTradeActions trade={trade} adminUserId={currentUser?.id} />}
        </div>
      </ScrollArea>
    </Card>
  );
}

export default TradeDetails;
