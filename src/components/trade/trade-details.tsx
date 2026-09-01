'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useToast } from '@/hooks/use-toast';
import { useCountdown } from '@/hooks/use-countdown';

import { completeEscrow } from '@/lib/wallet';
import { openDispute } from '@/lib/disputes';
import { cn, toDate } from '@/lib/utils';
import { statusColors } from '@/lib/status-colors';
import type { Feedback, P2PAd, Trade, Dispute, User } from '@/lib/types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

import { FlagIcon } from '@/components/ui/flag-icon';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw, Loader2, Flag, ThumbsUp, ThumbsDown, Shield, Gavel } from 'lucide-react';
import { add } from 'date-fns';
import { Input } from '../ui/input';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { adminCancelTrade, adminMarkTradeAsPaid, adminReleaseFunds, resolveDispute } from '@/lib/admin';
import { AdminActionDialog } from '../admin/admin-action-dialog';
import { Checkbox } from '../ui/checkbox';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';

function DetailRow({
  label,
  value,
  valueClass,
  isLink = false,
  href = '#',
}: {
  label: string;
  value: string | React.ReactNode;
  valueClass?: string;
  isLink?: boolean;
  href?: string;
}) {
  const valueContent = isLink ? (
    <Button variant="link" asChild className="p-0 h-auto font-medium text-right">
      <Link href={href}>{value}</Link>
    </Button>
  ) : (
    <p className={cn(`font-medium text-right`, valueClass)}>{value}</p>
  );
  return (
    <div className="flex justify-between items-center text-sm">
      <p className="text-muted-foreground">{label}</p>
      {valueContent}
    </div>
  );
}

function ParticipantRow({ label, user }: { label: string; user?: { username: string; country?: string } }) {
  if (!user || !user.username) {
    return (
      <div className="flex justify-between items-center text-sm">
        <p className="text-muted-foreground">{label}</p>
        <p className="font-medium text-right text-muted-foreground">Unknown</p>
      </div>
    );
  }
  return (
    <div className="flex justify-between items-center text-sm">
      <p className="text-muted-foreground">{label}</p>
      <Button variant="link" asChild className="p-0 h-auto font-medium">
        <Link href={`/users/${user.username}`} className="flex items-center gap-2">
          {user.username}
          {user.country && <FlagIcon countryCode={user.country} />}
        </Link>
      </Button>
    </div>
  );
}

const disputeSchema = z.object({
  reason: z.string().min(1, 'Please select a reason for the dispute.'),
  explanation: z
    .string()
    .min(10, 'Explanation must be at least 10 characters.')
    .max(500, 'Explanation cannot exceed 500 characters.'),
});
type DisputeFormValues = z.infer<typeof disputeSchema>;
const disputeReasons = [
  'I have paid, but the seller has not released the crypto.',
  'Buyer has not paid, but marked the trade as paid.',
  'Buyer paid the wrong amount.',
  'The other party is unresponsive.',
  'I suspect fraudulent activity or a scam.',
  'Other (please explain in detail below).',
];

function OpenDisputeDialog({
  trade,
  currentUserId,
  currentUsername,
  disabled,
}: {
  trade: Trade;
  currentUserId: string;
  currentUsername: string;
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<DisputeFormValues>({
    resolver: zodResolver(disputeSchema),
    defaultValues: { reason: '', explanation: '' },
  });

  const { isSubmitting } = form.formState;

  async function onSubmit(values: DisputeFormValues) {
    try {
      await openDispute(null, trade, currentUserId, currentUsername, values.reason, values.explanation);
      toast({ title: 'Dispute Opened', description: 'A moderator will join the chat shortly to assist you.' });
      setIsOpen(false);
      form.reset();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed to Open Dispute', description: error.message });
    }
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" className="w-full" disabled={disabled}>
          <Flag className="mr-2 h-4 w-4" /> Open Dispute
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open a Dispute for Trade {trade.tradeId}</AlertDialogTitle>
          <AlertDialogDescription>
            Please provide a clear reason for the dispute. A moderator will review all evidence.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a reason" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {disputeReasons.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="explanation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Explanation</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Explain the situation clearly..." {...field} className="min-h-[100px]" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Dispute
            </Button>
          </form>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ActionButtons = ({ trade, currentUserRole }: { trade: Trade; currentUserRole: 'buy' | 'sell' }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [cancelInput, setCancelInput] = useState('');
  const [isReleasing, setIsReleasing] = useState(false);
  const isCancelInputCorrect = cancelInput.trim().toLowerCase() === 'i did not paid';

  // Dispute Timer Logic
  const disputeUnlockTime = trade.paidAt ? add(toDate(trade.paidAt)!, { hours: 3 }) : null;
  const disputeCountdown = useCountdown(disputeUnlockTime || new Date(0));
  const isDisputeWaiting = trade.status === 'paid' && !disputeCountdown.isFinished;

  if (!user) return null;

  const handleMarkAsPaid = async () => {
    try {
      const now = new Date().toISOString();
      await supabase.from('trades').update({ status: 'paid', paid_at: now }).eq('id', trade.id);
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message: 'Buyer has marked the trade as Paid.',
          is_moderator: true,
          created_at: now,
        },
      ]);
      toast({ title: 'Success', description: "Seller has been notified that you've paid." });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const handleReleaseCrypto = async () => {
    setIsReleasing(true);
    try {
      await completeEscrow(trade.id);
      const now = new Date().toISOString();
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message:
            'Seller has released the crypto. The trade is complete.\nYou can now leave feedback for your partner.',
          is_moderator: true,
          created_at: now,
        },
      ]);
      toast({ title: 'Crypto Released', description: 'The crypto has been sent to the buyer.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message || 'Failed to release crypto.' });
    } finally {
      setIsReleasing(false);
    }
  };

  const handleCancelTrade = async () => {
    try {
      const now = new Date().toISOString();
      await supabase.from('trades').update({ status: 'cancelled' }).eq('id', trade.id);
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message: 'Trade has been cancelled by the buyer.',
          is_moderator: true,
          created_at: now,
        },
      ]);
      toast({ title: 'Trade Cancelled' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Error', description: e.message });
    }
  };

  const canBuyerCancel = currentUserRole === 'buy' && trade.status === 'active';
  const canSellerRelease = currentUserRole === 'sell' && (trade.status === 'paid' || trade.status === 'disputed');
  const canBuyerMarkPaid = currentUserRole === 'buy' && trade.status === 'active';

  return (
    <div className="space-y-4 w-full">
      <div className="space-y-2">
        {canBuyerMarkPaid && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" size="lg">
                Mark as Paid
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Payment</AlertDialogTitle>
                <AlertDialogDescription>
                  Have you sent{' '}
                  <span className="font-bold">
                    {trade.fiatAmount} {trade.fiatCurrency}
                  </span>{' '}
                  to the seller? Only confirm after you have fully sent the payment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleMarkAsPaid}>Yes, I Have Paid</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canSellerRelease && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="w-full" size="lg" disabled={isReleasing}>
                {isReleasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Release Crypto
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Release Cryptocurrency?</AlertDialogTitle>
                <AlertDialogDescription>
                  Confirm you have received{' '}
                  <span className="font-bold">
                    {trade.fiatAmount} {trade.fiatCurrency}
                  </span>
                  . This action is irreversible.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isReleasing}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleReleaseCrypto} disabled={isReleasing}>
                  {isReleasing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm and Release
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {canBuyerCancel && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="w-full">
                Cancel Trade
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Trade Cancellation</AlertDialogTitle>
                <AlertDialogDescription>
                  To prevent accidental cancellations, please type &quot;I DID NOT PAID&quot; in the box below to
                  confirm you have not sent payment.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="py-4">
                <Input
                  value={cancelInput}
                  onChange={(e) => setCancelInput(e.target.value)}
                  placeholder='Type "I DID NOT PAID"'
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

        {trade.status === 'paid' && (
          <OpenDisputeDialog
            trade={trade}
            currentUserId={user.uid}
            currentUsername={user.displayName || 'user'}
            disabled={isDisputeWaiting}
          />
        )}
      </div>
      {isDisputeWaiting && (
        <div className="text-center p-4 border rounded-lg bg-secondary/50">
          <p className="text-sm font-semibold mb-2">Dispute option available in:</p>
          <div className="flex justify-center gap-2">
            <div className="flex flex-col items-center p-2 bg-background rounded-md w-16 shadow-inner">
              <span className="text-2xl font-mono text-destructive font-bold">
                {String(disputeCountdown.hours).padStart(2, '0')}
              </span>
              <span className="text-xs text-muted-foreground">HRS</span>
            </div>
            <div className="flex flex-col items-center p-2 bg-background rounded-md w-16 shadow-inner">
              <span className="text-2xl font-mono text-destructive font-bold">
                {String(disputeCountdown.minutes).padStart(2, '0')}
              </span>
              <span className="text-xs text-muted-foreground">MIN</span>
            </div>
            <div className="flex flex-col items-center p-2 bg-background rounded-md w-16 shadow-inner">
              <span className="text-2xl font-mono text-destructive font-bold">
                {String(disputeCountdown.seconds).padStart(2, '0')}
              </span>
              <span className="text-xs text-muted-foreground">SEC</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const feedbackSchema = z.object({
  rating: z.enum(['positive', 'negative'], { required_error: 'Please select a rating.' }),
  comment: z.string().min(1, 'Comment is required.').max(500, 'Comment cannot exceed 500 characters.'),
});

type FeedbackFormValues = z.infer<typeof feedbackSchema>;

function FeedbackForm({
  trade,
  existingFeedback,
  onFeedbackSaved,
}: {
  trade: Trade;
  existingFeedback?: Feedback;
  onFeedbackSaved?: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<FeedbackFormValues>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: {
      rating: existingFeedback?.rating,
      comment: existingFeedback?.comment || '',
    },
  });

  useEffect(() => {
    form.reset({
      rating: existingFeedback?.rating,
      comment: existingFeedback?.comment || '',
    });
  }, [existingFeedback, form]);

  const { isSubmitting } = form.formState;

  async function onSubmit(values: FeedbackFormValues) {
    if (!user || !user.displayName) {
      toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to leave feedback.' });
      return;
    }
    const opponentId = user.uid === trade.buyerId ? trade.sellerId : trade.buyerId;

    try {
      const now = new Date().toISOString();
      const feedbackPayload = {
        trade_id: trade.id,
        from_user: user.uid,
        from_username: user.displayName,
        to_user: opponentId,
        rating: values.rating,
        comment: values.comment,
        created_at: now,
      };

      if (existingFeedback) {
        await supabase
          .from('trade_feedback')
          .update({ rating: values.rating, comment: values.comment })
          .eq('id', existingFeedback.id);
      } else {
        await supabase.from('trade_feedback').insert([feedbackPayload]);
      }

      // Add system message to chat
      await supabase.from('trade_messages').insert([
        {
          trade_id: trade.id,
          sender_id: 'system',
          sender_username: 'System',
          message: `${user.displayName} left you ${values.rating} feedback.`,
          is_moderator: true,
          created_at: now,
        },
      ]);

      // Add notification for opponent
      await supabase.from('notifications').insert([
        {
          user_id: opponentId,
          message: `${user.displayName} left you ${values.rating} feedback for trade ${trade.tradeId || trade.id}.`,
          link: `/trade/${trade.id}`,
          is_read: false,
          created_at: now,
        },
      ]);

      toast({
        title: existingFeedback ? 'Feedback Updated' : 'Feedback Submitted',
        description: 'Thank you for your feedback!',
      });
      if (onFeedbackSaved) onFeedbackSaved();
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error', description: `Failed to submit feedback: ${error.message}` });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4 border-t">
        <h4 className="font-semibold text-center text-sm text-foreground">
          {existingFeedback ? 'Update Your Feedback' : 'Leave Feedback'}
        </h4>
        <FormField
          control={form.control}
          name="rating"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormControl>
                <div className="flex gap-4 justify-center">
                  <Label
                    htmlFor="rating-positive"
                    className={cn(
                      'flex w-full items-center gap-3 cursor-pointer p-3 border rounded-md font-normal transition-colors',
                      field.value === 'positive'
                        ? 'border-green-500 bg-green-100/50 dark:bg-green-900/20'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <Checkbox
                      id="rating-positive"
                      checked={field.value === 'positive'}
                      onCheckedChange={() => field.onChange('positive')}
                      className="h-5 w-5"
                    />
                    <span className="flex items-center gap-2 font-medium">
                      <ThumbsUp className="h-5 w-5 text-green-600" /> Positive
                    </span>
                  </Label>

                  <Label
                    htmlFor="rating-negative"
                    className={cn(
                      'flex w-full items-center gap-3 cursor-pointer p-3 border rounded-md font-normal transition-colors',
                      field.value === 'negative'
                        ? 'border-red-500 bg-red-100/50 dark:bg-red-900/20'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <Checkbox
                      id="rating-negative"
                      checked={field.value === 'negative'}
                      onCheckedChange={() => field.onChange('negative')}
                      className="h-5 w-5"
                    />
                    <span className="flex items-center gap-2 font-medium">
                      <ThumbsDown className="h-5 w-5 text-red-600" /> Negative
                    </span>
                  </Label>
                </div>
              </FormControl>
              <FormMessage className="text-center" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="comment"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Textarea placeholder="Leave a comment about your trading experience..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {existingFeedback ? 'Update Feedback' : 'Submit Feedback'}
        </Button>
      </form>
    </Form>
  );
}

function AdminTradeActions({ trade }: { trade: Trade }) {
  const { user: adminUser } = useAuth();
  const { toast } = useToast();
  const [dialogState, setDialogState] = useState<{
    open: boolean;
    action: 'cancel' | 'paid' | 'release' | 'award_buyer' | 'award_seller' | null;
  }>({ open: false, action: null });

  const handleActionConfirm = async (reason: string) => {
    if (!dialogState.action || !adminUser) return;
    const { action } = dialogState;

    try {
      if (action === 'cancel') await adminCancelTrade(null, trade, adminUser.uid, reason);
      else if (action === 'paid') await adminMarkTradeAsPaid(null, trade, adminUser.uid, reason);
      else if (action === 'release') await adminReleaseFunds(null, trade, adminUser.uid, reason);
      else if (action === 'award_buyer' || action === 'award_seller') {
        const { data: disputeData } = await supabase
          .from('disputes')
          .select('*')
          .eq('trade_id', trade.id)
          .eq('status', 'open')
          .limit(1);

        if (!disputeData || disputeData.length === 0) throw new Error('No open dispute found for this trade.');
        const dispute = { id: disputeData[0].id, ...disputeData[0] } as Dispute;
        const winnerId = action === 'award_buyer' ? trade.buyerId : trade.sellerId;
        await resolveDispute(null, trade, dispute, winnerId, adminUser.uid, trade.fiatAmountInUSD || 0);
      }
      toast({ title: 'Admin Action Successful', description: 'The trade has been updated.' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Admin Action Failed', description: e.message });
    } finally {
      setDialogState({ open: false, action: null });
    }
  };

  return (
    <>
      <AdminActionDialog
        open={dialogState.open}
        onOpenChange={(open) => setDialogState((prev) => ({ ...prev, open }))}
        user={null}
        action={dialogState.action}
        onConfirm={handleActionConfirm}
      />
      <Card className="border-destructive mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {trade.status === 'disputed' ? (
            <>
              <Button variant="outline" onClick={() => setDialogState({ open: true, action: 'award_buyer' })}>
                <Gavel className="mr-2 h-4 w-4" /> Award to Buyer
              </Button>
              <Button variant="outline" onClick={() => setDialogState({ open: true, action: 'award_seller' })}>
                <Gavel className="mr-2 h-4 w-4" /> Award to Seller
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setDialogState({ open: true, action: 'cancel' })}>
                Cancel Trade
              </Button>
              <Button variant="outline" onClick={() => setDialogState({ open: true, action: 'paid' })}>
                Mark as Paid
              </Button>
              <Button variant="outline" onClick={() => setDialogState({ open: true, action: 'release' })}>
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
  currentUserRole,
}: {
  trade: Trade;
  ad?: P2PAd | null;
  currentUserRole: 'buy' | 'sell';
}) {
  const isBuying = currentUserRole === 'buy';
  const showReopen = ['cancelled', 'expired'].includes(trade.status);
  const { user } = useAuth();
  const { isAdmin } = useAdminStatus();

  const paymentTimeRemaining = useCountdown(trade.status === 'active' ? trade.expiresAt : new Date(0));
  const [userFeedback, setUserFeedback] = useState<Feedback | undefined>(undefined);
  const [resolvedDispute, setResolvedDispute] = useState<Dispute | undefined>(undefined);

  const fetchTradeFeedbackAndDispute = async () => {
    if (!user || !trade?.id) return;
    try {
      const { data: fbData } = await supabase
        .from('trade_feedback')
        .select('*')
        .eq('trade_id', trade.id)
        .eq('from_user', user.uid)
        .limit(1);

      if (fbData && fbData.length > 0) {
        setUserFeedback({
          id: fbData[0].id,
          tradeId: fbData[0].trade_id,
          fromUser: fbData[0].from_user,
          fromUsername: fbData[0].from_username,
          toUser: fbData[0].to_user,
          rating: fbData[0].rating,
          comment: fbData[0].comment,
          createdAt: fbData[0].created_at,
        });
      }

      const { data: dispData } = await supabase
        .from('disputes')
        .select('*')
        .eq('trade_id', trade.id)
        .eq('status', 'resolved')
        .limit(1);

      if (dispData && dispData.length > 0) {
        setResolvedDispute({
          id: dispData[0].id,
          tradeId: dispData[0].trade_id,
          openedBy: dispData[0].opened_by,
          reason: dispData[0].reason,
          explanation: dispData[0].explanation,
          status: dispData[0].status,
          winnerId: dispData[0].winner_id,
          resolvedBy: dispData[0].resolved_by,
          resolvedAt: dispData[0].resolved_at,
          createdAt: dispData[0].created_at,
        });
      }
    } catch (err) {
      console.error('Error fetching feedback or dispute:', err);
    }
  };

  useEffect(() => {
    fetchTradeFeedbackAndDispute();
  }, [user?.uid, trade?.id]);

  useEffect(() => {
    const expireTrade = async () => {
      if (trade.status === 'active' && paymentTimeRemaining.isFinished) {
        try {
          await supabase.from('trades').update({ status: 'expired' }).eq('id', trade.id);
        } catch (e) {
          console.error('Failed to auto-expire trade:', e);
        }
      }
    };
    expireTrade();
  }, [paymentTimeRemaining.isFinished, trade]);

  const showFeedbackSection = trade.status === 'released';
  const showActions = ['active', 'paid'].includes(trade.status);

  return (
    <Card className="flex flex-col h-full shadow-none border-0 rounded-none">
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Trade Details</CardTitle>
            <CardDescription>ID: {trade?.tradeId || 'N/A'}</CardDescription>
          </div>
          <Badge variant="outline" className={cn('capitalize', statusColors[trade.status])}>
            {trade?.status || 'unknown'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto space-y-4">
        <div className="space-y-2 rounded-md border p-4">
          <DetailRow
            label={isBuying ? 'You are buying' : 'You are selling'}
            value={`${trade?.amount ?? 0} ${trade?.crypto ?? ''}`}
          />
          <DetailRow
            label="Price"
            value={`1 ${trade?.crypto ?? ''} = ${(trade?.price ?? 0).toLocaleString()} ${trade?.fiatCurrency ?? ''}`}
          />
          {trade.escrowFee && (
            <DetailRow label="Escrow Fee (1%)" value={`${trade.escrowFee.toFixed(8)} ${trade.crypto}`} />
          )}
          <hr className="my-2 border-dashed" />
          <DetailRow
            label={isBuying ? 'You will pay' : 'You will receive'}
            value={`${(trade?.fiatAmount ?? 0).toLocaleString()} ${trade?.fiatCurrency ?? ''}`}
            valueClass={isBuying ? 'text-lg font-bold text-destructive' : 'text-lg font-bold text-green-600'}
          />
        </div>

        {showActions && !isAdmin && (
          <div className="pt-2">
            <ActionButtons trade={trade} currentUserRole={currentUserRole} />
          </div>
        )}

        {trade.status === 'active' && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Payment Window</AlertTitle>
            <AlertDescription className="flex items-center gap-2">
              Time remaining:{' '}
              <span className="font-semibold font-mono text-destructive">{`${String(paymentTimeRemaining.hours).padStart(2, '0')}:${String(paymentTimeRemaining.minutes).padStart(2, '0')}:${String(paymentTimeRemaining.seconds).padStart(2, '0')}`}</span>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <h4 className="font-semibold">Participants & Payment</h4>
          <ParticipantRow label="Buyer" user={trade?.buyer} />
          <ParticipantRow label="Seller" user={trade?.seller} />
          {trade.paymentMethod && <DetailRow label="Payment Method" value={trade.paymentMethod} />}
        </div>
        <div className="space-y-2">
          <h4 className="font-semibold">Timestamps</h4>
          <DetailRow
            label="Created At"
            value={
              toDate(trade?.createdAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'
            }
          />
          {trade?.paidAt && (
            <DetailRow
              label="Paid At"
              value={
                toDate(trade.paidAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'
              }
            />
          )}
          {trade?.releasedAt && (
            <DetailRow
              label="Released At"
              value={
                toDate(trade.releasedAt)?.toLocaleString('default', { dateStyle: 'short', timeStyle: 'short' }) ?? 'N/A'
              }
            />
          )}
        </div>

        {resolvedDispute && (
          <div className="space-y-2">
            <h4 className="font-semibold">Dispute Resolution</h4>
            <DetailRow
              label="Winner"
              value={resolvedDispute.winnerId === trade.buyerId ? trade.buyer?.username : trade.seller?.username}
            />
            <DetailRow
              label="Outcome"
              value={
                <span className="capitalize">
                  {trade.status === 'released' ? 'Trade Completed' : 'Trade Cancelled'}
                </span>
              }
            />
          </div>
        )}

        <div className="space-y-2">
          <h4 className="font-semibold">Ad Details</h4>
          {ad?.publicAdId && <DetailRow label="Ad ID" value={ad.publicAdId} isLink href={`/ad/${ad.id}`} />}
          {ad?.offerLabel && <DetailRow label="Offer Label" value={ad.offerLabel} />}
          {ad?.tags && ad.tags.length > 0 && (
            <div className="flex justify-between items-start text-sm">
              <p className="text-muted-foreground">Tags</p>
              <div className="flex flex-wrap gap-1 justify-end max-w-[70%]">
                {ad.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {ad?.terms && (
            <div className="space-y-1 pt-2">
              <p className="text-muted-foreground text-sm">Seller&apos;s Terms</p>
              <div className="text-sm p-3 bg-secondary rounded-md text-muted-foreground whitespace-pre-wrap">
                <p>{ad.terms}</p>
              </div>
            </div>
          )}
        </div>

        {showReopen && (
          <Button asChild variant="outline" className="w-full !mt-6">
            <Link href={`/ad/${trade.adId}`}>
              <RefreshCw className="mr-2 h-4 w-4" /> Reopen Trade
            </Link>
          </Button>
        )}

        {showFeedbackSection && (
          <FeedbackForm
            trade={trade}
            existingFeedback={userFeedback}
            onFeedbackSaved={fetchTradeFeedbackAndDispute}
          />
        )}
        {isAdmin && <AdminTradeActions trade={trade} />}
      </CardContent>
    </Card>
  );
}
