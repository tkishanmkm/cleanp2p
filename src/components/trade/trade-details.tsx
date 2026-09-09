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
import { cn, toDate } from '@/lib/utils';
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

const DetailRow = ({
  label,
  value,
  isLink = false,
  href = '#',
  valueClass = ''
}: {
  label: string;
  value: React.ReactNode;
  isLink?: boolean;
  href?: string;
  valueClass?: string;
}) => (
  <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40 last:border-0">
    <p className="text-muted-foreground">{label}</p>
    {isLink ? (
      <Link href={href} className="font-mono font-medium text-primary hover:underline">
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
          .select('username')
          .eq('id', userId)
          .maybeSingle();

        if (data?.username) {
          setDisplayUsername(data.username);
          return;
        }
      }
      setDisplayUsername(fallbackUsername || userId);
    };

    fetchUsername();
  }, [userId, fallbackUsername, supabase]);

  return (
    <div className="flex justify-between items-center text-xs sm:text-sm py-1.5 border-b border-border/40">
      <p className="text-muted-foreground">{label}</p>
      <Link
        href={`/users/${displayUsername}`}
        className="font-semibold text-primary hover:underline flex items-center gap-1.5"
      >
        <span>@{displayUsername}</span>
      </Link>
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
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message: `⚠️ Issue Reported by @${currentUsername || 'Trader'}:\nCategory: ${selectedIssue}\nDetails: ${details.trim()}`,
          is_moderator: true,
          created_at: new Date().toISOString()
        }
      ]);

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
      setIsOpen(false);
      setSelectedIssue('');
      setDetails('');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Report Failed', description: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

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

  const [cancelInput, setCancelInput] = useState('');
  const [isPaidConfirmOpen, setIsPaidConfirmOpen] = useState(false);
  const [isReleaseConfirmOpen, setIsReleaseConfirmOpen] = useState(false);

  const canMarkPaid = isBuyer && tradeStatus === 'active';
  const canRelease = !isBuyer && (tradeStatus === 'paid' || tradeStatus === 'active');
  const canBuyerCancel = isBuyer && tradeStatus === 'active';

  const paidAtDate = trade?.paidAt || trade?.paid_at ? new Date(trade?.paidAt || trade?.paid_at) : null;
  const disputeAvailableTime = paidAtDate ? new Date(paidAtDate.getTime() + 10 * 60 * 1000) : new Date(0);
  const disputeCountdown = useCountdown(disputeAvailableTime);
  const isDisputeWaiting = tradeStatus === 'paid' && !disputeCountdown.isFinished;

  const handleMarkAsPaid = async () => {
    try {
      await markTradeAsPaid(trade);
      toast({ title: 'Trade marked as paid', description: 'The seller has been notified to release coin.' });
      setIsPaidConfirmOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleReleaseCrypto = async () => {
    try {
      await releaseFundsFromEscrow(trade.id);
      toast({ title: 'Coin Released', description: 'Funds successfully transferred to buyer.' });
      setIsReleaseConfirmOpen(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleCancelTrade = async () => {
    try {
      await cancelTrade(trade, 'Cancelled by buyer');
      toast({ title: 'Trade Cancelled', description: 'Escrow deposit returned.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const isCancelInputCorrect = cancelInput.trim().toUpperCase() === 'I DID NOT PAID';

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
                <AlertDialogAction onClick={handleMarkAsPaid}>Confirm Paid</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canRelease && (
          <AlertDialog open={isReleaseConfirmOpen} onOpenChange={setIsReleaseConfirmOpen}>
            <AlertDialogTrigger asChild>
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                Release Coin
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Release Escrow Coin?</AlertDialogTitle>
                <AlertDialogDescription>
                  WARNING: This action is irreversible. Only release after verifying full payment in your bank/wallet account.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReleaseCrypto}>Confirm & Release</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {canBuyerCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full text-xs">
                Cancel Trade
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Trade Cancellation</AlertDialogTitle>
                <AlertDialogDescription>
                  To prevent accidental cancellations, please type &quot;I DID NOT PAID&quot; below:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-2">
                <Input
                  value={cancelInput}
                  onChange={(e) => setCancelInput(e.target.value)}
                  placeholder='Type "I DID NOT PAID"'
                  className="font-mono text-xs"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Back</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancelTrade} disabled={!isCancelInputCorrect}>
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
            disabled={isDisputeWaiting}
          />
        )}
      </div>

      {isDisputeWaiting && (
        <div className="text-center p-3 border rounded-lg bg-muted/30">
          <p className="text-xs font-semibold mb-1 text-muted-foreground">Dispute available in:</p>
          <div className="flex justify-center gap-1.5">
            <span className="font-mono font-bold text-destructive text-sm">
              {String(disputeCountdown.minutes).padStart(2, '0')}:{String(disputeCountdown.seconds).padStart(2, '0')}
            </span>
          </div>
        </div>
      )}
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
      if (existingFeedback?.id) {
        const { data: updatedData } = await supabase
          .from('feedback')
          .update({
            rating: values.rating,
            comment: values.comment
          })
          .eq('id', existingFeedback.id)
          .select()
          .maybeSingle();
        savedFbRecord = updatedData;
      } else {
        const { data: insertedData } = await supabase.from('feedback').insert([
          {
            trade_id: trade.id,
            from_user: currentUserId,
            from_username: currentUsername || 'Trader',
            to_user: opponentId,
            rating: values.rating,
            comment: values.comment,
            created_at: new Date().toISOString()
          }
        ]).select().maybeSingle();
        savedFbRecord = insertedData;
      }

      // 2. Adjust counts in profiles table
      const { data: allFb } = await supabase
        .from('feedback')
        .select('rating')
        .eq('to_user', opponentId);

      if (allFb) {
        const positiveCount = allFb.filter((f) => f.rating === 'positive').length;
        const negativeCount = allFb.filter((f) => f.rating === 'negative').length;
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

      // 3. Add system message in trade_messages
      const feedbackNotice = `@${currentUsername || 'Trader'} left ${values.rating} feedback: "${values.comment}"`;
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message: feedbackNotice,
          is_moderator: true,
          created_at: new Date().toISOString()
        }
      ]);

      // 4. Add notification for opponent
      await supabase.from('notifications').insert([
        {
          user_id: opponentId,
          message: `@${currentUsername || 'Trader'} left you ${values.rating} feedback for trade #${publicTradeId}.`,
          link: `/trade/${trade.id}`,
          is_read: false,
          created_at: new Date().toISOString()
        }
      ]);

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

        // Fetch existing feedback between these two users across any trade
        const oppId = user.id === buyerId ? sellerId : buyerId;
        if (oppId) {
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

  const expiresDate = trade?.expiresAt || trade?.expires_at ? new Date(trade?.expiresAt || trade?.expires_at) : new Date(Date.now() + 900000);
  const paymentTimeRemaining = useCountdown(tradeStatus === 'active' || tradeStatus === 'pending' ? expiresDate : new Date(0));

  useEffect(() => {
    const expireTrade = async () => {
      if ((tradeStatus === 'active' || tradeStatus === 'pending') && paymentTimeRemaining.isFinished) {
        try {
          const reason = 'Trade expired: Payment window timed out.';
          await cancelTrade(trade, reason);
        } catch (e) {
          console.error('Failed to auto-expire trade:', e);
        }
      }
    };
    expireTrade();
  }, [paymentTimeRemaining.isFinished, tradeStatus, trade]);

  const showFeedbackSection = tradeStatus === 'released' || tradeStatus === 'completed';
  const showActions = ['active', 'paid', 'pending'].includes(tradeStatus);

  const coinAmount = Number(trade?.amount ?? trade?.crypto_amount ?? 0).toFixed(8);
  const coinSymbol = trade?.crypto ?? trade?.asset_symbol ?? 'BTC';
  const priceFormatted = Number(trade?.price ?? 0).toLocaleString();
  const fiatAmount = Number(trade?.fiatAmount ?? trade?.fiat_amount ?? trade?.amount_usd ?? 0).toLocaleString();
  const fiatCurrency = trade?.fiatCurrency ?? trade?.fiat_currency ?? trade?.fiat_symbol ?? 'USD';

  // Escrow Fee 1.5%
  const escrowFeeRate = 0.015;
  const escrowFeeCoin = (Number(trade?.amount ?? trade?.crypto_amount ?? 0) * escrowFeeRate).toFixed(8);

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
              <span className="text-muted-foreground">{isBuying ? 'You are buying' : 'You are selling'}</span>
              <div className="flex items-center gap-1.5">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold text-sm sm:text-base text-foreground tracking-tight">{coinAmount}</span>
                <CoinInsignia symbol={coinSymbol} className="h-4 w-4" />
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="text-muted-foreground">Rate</span>
              <div className="flex items-center gap-1 text-xs sm:text-sm font-medium text-foreground">
                <span>1 {coinSymbol} = </span>
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">{priceFormatted}</span>
                <span>{fiatCurrency}</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs sm:text-sm py-1 border-b border-border/40">
              <span className="text-muted-foreground">Escrow Fee (1.5%)</span>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-[Arial,Helvetica,sans-serif] tabular-nums font-bold tracking-tight">{escrowFeeCoin}</span>
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
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Participants & Payment
            </h4>
            <ParticipantRow
              label="Buyer"
              userId={buyerId}
              fallbackUsername={trade?.buyer_username || 'Buyer'}
            />
            <ParticipantRow
              label="Seller"
              userId={sellerId}
              fallbackUsername={trade?.seller_username || 'Seller'}
            />
            {(trade?.paymentMethod || trade?.payment_method) && (
              <DetailRow label="Payment Method" value={trade.paymentMethod || trade.payment_method} />
            )}
          </div>

          {/* Timestamps */}
          <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Timeline
            </h4>
            <DetailRow
              label="Created"
              value={toDate(trade?.createdAt || trade?.created_at)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}
              valueClass="font-mono text-xs"
            />
            {(trade?.paidAt || trade?.paid_at) && (
              <DetailRow
                label="Marked Paid"
                value={toDate(trade.paidAt || trade.paid_at)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}
                valueClass="font-mono text-xs"
              />
            )}
            {(trade?.releasedAt || trade?.released_at) && (
              <DetailRow
                label="Released"
                value={toDate(trade.releasedAt || trade.released_at)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'}
                valueClass="font-mono text-xs"
              />
            )}
          </div>

          {resolvedDispute && (
            <div className="space-y-1 rounded-xl border border-border/60 p-3 bg-muted/10">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                Dispute Resolution
              </h4>
              <DetailRow
                label="Awarded To"
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
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              Offer Terms
            </h4>
            {(ad?.publicAdId || ad?.ad_id || trade?.adId || trade?.ad_id) && (
              <DetailRow
                label="Ad Reference"
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
