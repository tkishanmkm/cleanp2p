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
import { usePlatformFeeSettings } from '@/hooks/use-platform-fees';
import { useI18n } from '@/context/i18n-context';

const createTransferSchema = (t: (key: string) => string) => z.object({
  recipient: z.string().min(1, t('transferDialog.schemaRecipientRequired')),
  amount: z.coerce.number().positive(t('transferDialog.schemaAmountPositive')),
  totpCode: z.string().optional(),
});

type TransferFormValues = z.infer<ReturnType<typeof createTransferSchema>>;

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
}

interface RecipientInfo {
  id: string;
  username: string;
  is_trading_eligible: boolean;
}

export function TransferDialog({ open, onOpenChange, asset }: TransferDialogProps) {
  const { t } = useI18n();
  const transferSchema = useMemo(() => createTransferSchema(t), [t]);
  const { user, profile: senderProfile } = useAuth();
  const { toast } = useToast();
  const { balances, refreshBalances } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [resolvedRecipient, setResolvedRecipient] = useState<RecipientInfo | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [is2faEnabledState, setIs2faEnabledState] = useState<boolean | null>(null);
  const { fees: platformFees, isLoading: isFeeSettingsLoading, error: feeSettingsError } = usePlatformFeeSettings();
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const existing = window.sessionStorage.getItem('pax_transfer_idemp');
      if (existing && existing.length >= 8) return existing;
      const fresh = globalThis.crypto.randomUUID();
      window.sessionStorage.setItem('pax_transfer_idemp', fresh);
      return fresh;
    }
    return globalThis.crypto.randomUUID();
  });

  const coin = asset || 'USDT';

  // Manage durable idempotency key when dialog opens
  useEffect(() => {
    if (open) {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const existing = window.sessionStorage.getItem('pax_transfer_idemp');
        if (existing && existing.length >= 8) {
          setIdempotencyKey(existing);
        } else {
          const fresh = globalThis.crypto.randomUUID();
          window.sessionStorage.setItem('pax_transfer_idemp', fresh);
          setIdempotencyKey(fresh);
        }
      } else {
        setIdempotencyKey(globalThis.crypto.randomUUID());
      }
    }
  }, [open]);

  // Actively check 2FA status from Supabase profiles table when dialog opens
  useEffect(() => {
    if (open && (user?.uid || user?.id)) {
      const uid = user.uid || user.id;
      const check2FA = async () => {
        try {
          const { data, error } = await supabase.rpc('get_user_2fa_status', {
            p_user_id: uid,
          });
          if (!error && typeof data === 'boolean') {
            setIs2faEnabledState(data);
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

  const feeRate = platformFees ? platformFees.platformFeePercent / 100 : 0;
  const transferFee = useMemo(() => {
    return Number((numericWatchedAmount * feeRate).toFixed(8));
  }, [numericWatchedAmount, feeRate]);

  const totalDeduction = useMemo(() => {
    return Number((numericWatchedAmount + transferFee).toFixed(8));
  }, [numericWatchedAmount, transferFee]);

  const isInsufficient = useMemo(() => {
    return totalDeduction > availableBalance;
  }, [totalDeduction, availableBalance]);

  // Max Button Logic: amount + configured fee must stay within the available balance.
  const handleSetMax = () => {
    if (!platformFees || availableBalance <= 0) return;
    const maxAmount = availableBalance / (1 + feeRate);
    // Round down to 6 decimals safely
    const rounded = Math.floor(maxAmount * 1000000) / 1000000;
    form.setValue('amount', rounded);
  };

  const isRecipientRestricted = useMemo(() => {
    return resolvedRecipient !== null && resolvedRecipient.is_trading_eligible !== true;
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
        // 1. Resolve usernames with a parameterized filter. Never interpolate
        // raw recipient input into a PostgREST .or() expression.
        const escapedTarget = target.replace(/[\\%_]/g, '\\$&');
        const { data: profByUsername } = await supabase
          .from('public_profiles')
          .select('id, username, is_trading_eligible')
          .ilike('username', escapedTarget)
          .maybeSingle();

        if (profByUsername) {
          setResolvedRecipient(profByUsername as RecipientInfo);
          return;
        }

        // 2. Resolve UUID recipients with a separate exact comparison.
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target);
        if (isUuid) {
          const { data: profileById } = await supabase
            .from('public_profiles')
            .select('id, username, is_trading_eligible')
            .eq('id', target)
            .maybeSingle();

          if (profileById) {
            setResolvedRecipient(profileById as RecipientInfo);
            return;
          }
        }

        // 3. Address ownership is resolved on the server because RLS only
        // permits users to read their own deposit-address rows.
        if (/^(?:0x[0-9a-fA-F]{40}|[A-Za-z0-9]{20,128})$/.test(target)) {
          const response = await fetch('/api/wallet/resolve-deposit-recipient', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: target }),
          });

          if (response.ok) {
            const payload = await response.json();
            if (payload?.recipient?.id && payload?.recipient?.username) {
              setResolvedRecipient(payload.recipient as RecipientInfo);
              return;
            }
          } else if (response.status !== 404) {
            throw new Error('Recipient address ownership could not be verified.');
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
        title: t('transferDialog.senderRestrictedTitle'),
        description: t('transferDialog.senderRestrictedDescription'),
      });
      return;
    }

    if (isRecipientRestricted) {
      toast({
        variant: 'destructive',
        title: t('transferDialog.recipientRestrictedTitle'),
        description: t('transferDialog.recipientRestrictedDescription').replace('{username}', String(resolvedRecipient?.username || '')),
      });
      return;
    }

    if (isFeeSettingsLoading || !platformFees) {
      toast({
        variant: 'destructive',
        title: t('transferDialog.unavailableTitle'),
        description: feeSettingsError || t('transferDialog.feeSettingsUnverified'),
      });
      return;
    }

    if (totalDeduction > availableBalance) {
      form.setError('amount', {
        message: t('transferDialog.insufficientBalance').replace('{fee}', platformFees.platformFeePercent.toFixed(2)).replace('{deducted}', String(totalDeduction)).replace('{available}', String(availableBalance)).replace('{asset}', String(asset)),
      });
      return;
    }

    if (is2faActive) {
      const otp = (values.totpCode || '').trim();
      if (!/^\d{6}$/.test(otp)) {
        form.setError('totpCode', {
          message: t('transferDialog.validOtp'),
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
        throw new Error(json.error || t('transferDialog.failedGeneric'));
      }

      if (json.idempotentReplay || json.idempotent_replay) {
        toast({
          title: t('transferDialog.transferAlreadyCompleted'),
          description: t('transferDialog.transferPreviouslyProcessed').replace('{id}', String(json.transferId)),
        });
      } else {
        toast({
          title: t('transferDialog.transferCompleted'),
          description: t('transferDialog.transferSuccessDescription').replace('{amount}', String(values.amount)).replace('{asset}', String(coin)).replace('{username}', String(json.recipientUsername)).replace('{id}', String(json.transferId)).replace('{fee}', String(json.fee)),
        });
      }

      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem('pax_transfer_idemp');
      }
      await refreshBalances();
      onOpenChange(false);
    } catch (err: any) {
      const msg = err.message || t('transferDialog.couldNotProcess');
      if (msg.toLowerCase().includes('totp') || msg.toLowerCase().includes('2fa') || msg.toLowerCase().includes('authenticator')) {
        setIs2faEnabledState(true);
      }
      toast({
        variant: 'destructive',
        title: t('transferDialog.transferFailed'),
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
              <DialogTitle className="text-xl font-bold">{t('transferDialog.title').replace('{asset}', String(coin))}</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {isFeeSettingsLoading
                  ? t('transferDialog.loadingFees')
                  : platformFees
                  ? t('transferDialog.feeDescription').replace('{fee}', platformFees.platformFeePercent.toFixed(2))
                  : t('transferDialog.disabledFeeSettings')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {isSenderRestricted && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg text-xs flex items-center gap-2">
            <Ban className="h-4 w-4 shrink-0" />
            <span>{t('transferDialog.restrictedBanner')}</span>
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
                  <FormLabel className="text-xs font-semibold">{t('transferDialog.recipientLabel')}</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        placeholder={t('transferDialog.recipientPlaceholder')}
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
                        {t('transferDialog.recipientRestrictedInline').replace('{username}', resolvedRecipient.username)}
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                        <UserCheck className="h-3.5 w-3.5" />
                        {t('transferDialog.recipientVerified')} <strong>@{resolvedRecipient.username}</strong>
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
                    <FormLabel className="text-xs font-semibold">{t('transferDialog.amountLabel')}</FormLabel>
                    <span className="text-[11px] text-muted-foreground">
                      {t('transferDialog.available')} <strong className="text-foreground">{availableBalance.toFixed(6)} {coin}</strong>
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
                        {t('transferDialog.max')}
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
                  {t('transferDialog.transferFee').replace('{fee}', platformFees ? platformFees.platformFeePercent.toFixed(2) : '—')}
                </span>
                <span className="font-mono font-medium text-foreground">
                  {transferFee > 0 ? transferFee.toFixed(6) : '0.00'} {coin}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-border/40 text-foreground font-semibold">
                <span>{t('transferDialog.totalAmountDeducted')}</span>
                <span className={`font-mono ${isInsufficient ? 'text-destructive font-bold' : 'text-blue-600 dark:text-blue-400'}`}>
                  {totalDeduction > 0 ? totalDeduction.toFixed(6) : '0.00'} {coin}
                </span>
              </div>
              {isInsufficient && (
                <p className="text-[11px] text-destructive pt-1">
                  {t('transferDialog.exceedsAvailableBalance').replace('{available}', String(availableBalance)).replace('{asset}', String(coin))}
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
                      {t('transferDialog.twoFactorOtp')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="transfer-totp-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder={t('transferDialog.otpPlaceholder')}
                        {...field}
                        onChange={(e) => field.onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
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
                isFeeSettingsLoading ||
                !platformFees ||
                isSenderRestricted ||
                isRecipientRestricted ||
                !numericWatchedAmount ||
                numericWatchedAmount <= 0 ||
                isInsufficient ||
                (is2faActive && !/^\d{6}$/.test(form.watch('totpCode') || ''))
              }
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-10 shadow-sm cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('transferDialog.processing')}
                </>
              ) : (
                <>
                  <ArrowRight className="mr-2 h-4 w-4" />
                  {t('transferDialog.submit').replace('{amount}', numericWatchedAmount > 0 ? `${numericWatchedAmount} ${coin}` : coin)}
                </>
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
