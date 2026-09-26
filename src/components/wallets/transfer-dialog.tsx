'use client';

import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { CryptoCurrency } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowRight, UserCheck, Sparkles, Percent, Ban, AlertCircle, Shield } from 'lucide-react';
import { useWallet } from '@/context/wallet-context';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';

const transferSchema = z.object({
  recipient: z.string().min(1, 'Username or deposit address is required.'),
  amount: z.coerce.number().positive('Amount must be greater than 0.'),
  totpCode: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
}

interface RecipientInfo {
  id: string;
  username: string;
  is_banned?: boolean;
  is_restricted?: boolean;
  account_status?: string;
}

export function TransferDialog({ open, onOpenChange, asset }: TransferDialogProps) {
  const { user, profile: senderProfile } = useAuth();
  const { toast } = useToast();
  const { balances, refreshBalances } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<RecipientInfo | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [is2faEnabledState, setIs2faEnabledState] = useState<boolean | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => globalThis.crypto.randomUUID());

  const coin = asset || 'USDT';

  // Generate a fresh idempotency key each time the transfer dialog opens
  useEffect(() => {
    if (open) {
      setIdempotencyKey(globalThis.crypto.randomUUID());
    }
  }, [open]);

  // Actively check 2FA status from Supabase profiles table when dialog opens
  useEffect(() => {
    if (open && (user?.uid || user?.id)) {
      const uid = user.uid || user.id;
      const check2FA = async () => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret')
            .or(`id.eq.${uid},user_id.eq.${uid}`)
            .maybeSingle();
          if (data) {
            const has2fa = Boolean(
              data.is_2fa_enabled === true ||
              data.is_2fa_enabled === 'true' ||
              data.is_mfa_enabled === true ||
              data.is_mfa_enabled === 'true' ||
              Boolean(data.two_factor_secret && String(data.two_factor_secret).trim().length > 0)
            );
            setIs2faEnabledState(has2fa);
          }
        } catch (e) {
          console.warn('TransferDialog 2FA check error:', e);
        }
      };
      check2FA();
    }
  }, [open, user]);

  const isSenderRestricted = useMemo(() => {
    if (!senderProfile) return false;
    return Boolean(
      senderProfile.is_banned ||
      (senderProfile as any).is_restricted ||
      (senderProfile as any).account_status === 'suspended' ||
      (senderProfile as any).account_status === 'banned' ||
      (senderProfile as any).account_status === 'restricted'
    );
  }, [senderProfile]);

  const is2faActive = useMemo(() => {
    return Boolean(
      is2faEnabledState ?? (senderProfile?.is_2fa_enabled || (senderProfile as any)?.is_mfa_enabled)
    );
  }, [is2faEnabledState, senderProfile]);

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      recipient: '',
      amount: '' as any,
      totpCode: '',
    },
  });

  const watchedAmount = form.watch('amount');
  const watchedRecipient = form.watch('recipient');

  const numericWatchedAmount = useMemo(() => {
    if (typeof watchedAmount === 'number') return isNaN(watchedAmount) ? 0 : watchedAmount;
    if (typeof watchedAmount === 'string') {
      const parsed = parseFloat(watchedAmount);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, [watchedAmount]);

  const availableBalance = useMemo(() => {
    if (!asset || !balances?.[asset]) return 0;
    return balances[asset].available || 0;
  }, [asset, balances]);

  // Transfer fee calculation: 1.5%
  // E.g., Transfer 100 USDT -> Fee is 1.5 USDT -> Total deducted: 101.5 USDT
  const transferFee = useMemo(() => {
    return Number((numericWatchedAmount * 0.015).toFixed(8));
  }, [numericWatchedAmount]);

  const totalDeduction = useMemo(() => {
    return Number((numericWatchedAmount + transferFee).toFixed(8));
  }, [numericWatchedAmount, transferFee]);

  const isInsufficient = useMemo(() => {
    return totalDeduction > availableBalance;
  }, [totalDeduction, availableBalance]);

  // Max Button Logic: Automatically computes max amount such that amount + 1.5% fee <= availableBalance
  // amount * 1.015 = availableBalance  ==>  amount = availableBalance / 1.015
  const handleSetMax = () => {
    if (availableBalance <= 0) return;
    const maxAmount = availableBalance / 1.015;
    // Round down to 6 decimals safely
    const rounded = Math.floor(maxAmount * 1000000) / 1000000;
    form.setValue('amount', rounded);
  };

  const isRecipientRestricted = useMemo(() => {
    if (!resolvedRecipient) return false;
    return Boolean(
      resolvedRecipient.is_banned ||
      resolvedRecipient.is_restricted ||
      resolvedRecipient.account_status === 'suspended' ||
      resolvedRecipient.account_status === 'banned' ||
      resolvedRecipient.account_status === 'restricted'
    );
  }, [resolvedRecipient]);

  // Real-time recipient check (username or deposit address)
  useEffect(() => {
    const checkRecipient = async () => {
      const target = (watchedRecipient || '').trim().replace(/^@/, '');
      if (!target || target.length < 2) {
        setResolvedRecipient(null);
        return;
      }

      setIsResolving(true);
      try {
        // 1. Check by username or UUID
        const { data: prof } = await supabase
          .from('profiles')
          .select('id, username, is_banned, is_restricted, account_status')
          .or(`username.ilike.${target},id.eq.${target}`)
          .maybeSingle();

        if (prof) {
          setResolvedRecipient(prof as RecipientInfo);
          return;
        }

        // 2. Check by deposit address
        const { data: dep } = await supabase
          .from('deposit_addresses')
          .select('user_id')
          .eq('address', target)
          .maybeSingle();

        if (dep?.user_id) {
          const { data: p } = await supabase
            .from('profiles')
            .select('id, username, is_banned, is_restricted, account_status')
            .eq('id', dep.user_id)
            .maybeSingle();
          if (p) {
            setResolvedRecipient(p as RecipientInfo);
            return;
          }
        }

        setResolvedRecipient(null);
      } catch (e) {
        setResolvedRecipient(null);
      } finally {
        setIsResolving(false);
      }
    };

    const timer = setTimeout(checkRecipient, 300);
    return () => clearTimeout(timer);
  }, [watchedRecipient]);

  // Reset on open
  useEffect(() => {
    if (open) {
      form.reset({
        recipient: '',
        amount: '' as any,
        totpCode: '',
      });
      setResolvedRecipient(null);
    }
  }, [open, form]);

  async function onSubmit(values: TransferFormValues) {
    if (!user || !asset) return;

    if (isSenderRestricted) {
      toast({
        variant: 'destructive',
        title: 'Account Restricted',
        description: 'Your account is banned or restricted. You cannot send transfers.',
      });
      return;
    }

    if (isRecipientRestricted) {
      toast({
        variant: 'destructive',
        title: 'Recipient Restricted',
        description: `Cannot transfer: Recipient @${resolvedRecipient?.username} is banned or restricted on the platform.`,
      });
      return;
    }

    if (totalDeduction > availableBalance) {
      form.setError('amount', {
        message: `Insufficient balance. Total deduction with 1.5% fee is ${totalDeduction} ${asset}, but available is ${availableBalance} ${asset}.`,
      });
      return;
    }

    if (is2faActive) {
      const otp = (values.totpCode || '').trim();
      if (!otp || otp.length < 4 || otp.length > 8) {
        form.setError('totpCode', {
          message: 'Valid 4-8 digit authenticator OTP code is required for transfers.',
        });
        return;
      }
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey,
        },
        body: JSON.stringify({
          recipientInput: values.recipient.trim(),
          asset: coin,
          amount: Number(values.amount),
          totpCode: values.totpCode,
          idempotencyKey,
        }),
      });

      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'Failed to complete internal transfer');
      }

      if (json.idempotentReplay || json.idempotent_replay) {
        toast({
          title: 'Transfer Already Completed',
          description: `This transfer was previously processed (ID: ${json.transferId}).`,
        });
      } else {
        toast({
          title: 'Transfer Completed Instantly!',
          description: `Sent ${values.amount} ${coin} to @${json.recipientUsername} (ID: ${json.transferId}) with fee ${json.fee} ${coin}.`,
        });
      }

      await refreshBalances();
      onOpenChange(false);
    } catch (err: any) {
      const msg = err.message || 'Could not process internal transfer.';
      if (msg.toLowerCase().includes('totp') || msg.toLowerCase().includes('2fa') || msg.toLowerCase().includes('authenticator')) {
        setIs2faEnabledState(true);
      }
      toast({
        variant: 'destructive',
        title: 'Transfer Failed',
        description: msg,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px] border border-blue-500/20 bg-background/95 backdrop-blur-sm shadow-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Instant Transfer {coin}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Zero network confirmation wait · 1.5% platform transfer fee
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isSenderRestricted && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs flex items-center gap-2">
            <Ban className="h-4 w-4 shrink-0" />
            <span>Your account is restricted or banned. You cannot send or receive transfers.</span>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            {/* Recipient Field */}
            <FormField
              control={form.control}
              name="recipient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs font-semibold">Recipient (Username or Address)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        placeholder="e.g. quickbot.65 or deposit address"
                        {...field}
                        value={field.value || ''}
                        disabled={isSenderRestricted}
                        className="pr-10"
                      />
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        {isResolving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : resolvedRecipient ? (
                          isRecipientRestricted ? (
                            <Ban className="h-4 w-4 text-destructive" />
                          ) : (
                            <div className="flex items-center gap-1 text-emerald-500 text-xs font-medium">
                              <UserCheck className="h-4 w-4" />
                            </div>
                          )
                        ) : null}
                      </div>
                    </div>
                  </FormControl>
                  {resolvedRecipient && (
                    isRecipientRestricted ? (
                      <p className="text-[11px] text-destructive font-medium flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Recipient <strong>@{resolvedRecipient.username}</strong> is banned or restricted. Transfers are blocked.
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <UserCheck className="h-3.5 w-3.5" />
                        Recipient verified: <strong>@{resolvedRecipient.username}</strong>
                      </p>
                    )
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Amount Field */}
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <div className="flex justify-between items-center">
                    <FormLabel className="text-xs font-semibold">Transfer Amount</FormLabel>
                    <span className="text-[11px] text-muted-foreground">
                      Available: <strong className="text-foreground">{availableBalance.toFixed(6)} {coin}</strong>
                    </span>
                  </div>
                  <FormControl>
                    <div className="relative">
                      <Input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        {...field}
                        value={field.value === undefined ? '' : field.value}
                        disabled={isSenderRestricted}
                        className="pr-16 font-mono font-bold"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={isSenderRestricted}
                        onClick={handleSetMax}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 px-2.5 text-xs font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 border-0"
                      >
                        MAX
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Fee Breakdown Box */}
            <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-50/40 dark:bg-blue-950/20 space-y-2 text-xs">
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Percent className="h-3 w-3 text-blue-500" />
                  Transfer Fee (1.5%):
                </span>
                <span className="font-mono font-medium text-foreground">
                  {transferFee > 0 ? transferFee.toFixed(6) : '0.00'} {coin}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-border/40 text-foreground font-semibold">
                <span>Total Amount Deducted:</span>
                <span className={`font-mono ${isInsufficient ? 'text-destructive font-bold' : 'text-blue-600 dark:text-blue-400'}`}>
                  {totalDeduction > 0 ? totalDeduction.toFixed(6) : '0.00'} {coin}
                </span>
              </div>
              {isInsufficient && (
                <p className="text-[11px] text-destructive pt-1">
                  Exceeds your available balance of {availableBalance} {coin}.
                </p>
              )}
            </div>

            {/* 2FA OTP Field when Two-Factor Authentication is enabled */}
            {is2faActive && (
              <FormField
                control={form.control}
                name="totpCode"
                render={({ field }) => (
                  <FormItem className="space-y-1.5 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                    <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                      <Shield className="h-3.5 w-3.5" />
                      Two-Factor Authentication (2FA) OTP
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="transfer-totp-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={8}
                        placeholder="Enter 4-8 digit authenticator OTP"
                        {...field}
                        className="font-mono text-center tracking-widest bg-background"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button
              id="submit-wallet-transfer-btn"
              type="submit"
              disabled={
                isLoading ||
                isSenderRestricted ||
                isRecipientRestricted ||
                !numericWatchedAmount ||
                numericWatchedAmount <= 0 ||
                isInsufficient ||
                (is2faActive && (!form.watch('totpCode') || form.watch('totpCode')!.trim().length < 4))
              }
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-10 shadow-sm cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing Instant Transfer...
                </>
              ) : (
                <>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  Transfer {numericWatchedAmount > 0 ? `${numericWatchedAmount} ${coin}` : coin}
                </>
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
