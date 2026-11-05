'use client';

import { useMemo, useEffect, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { sendCoinToUser, getUserWalletBalances } from '@/lib/wallet';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, ShieldCheck, Shield, Link, ArrowRight, CheckCircle2 } from 'lucide-react';
import { CryptoCurrency, CoinTransfer } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { CoinBadgeLogo } from '@/components/wallets/coin-badge-logo';
import { usePlatformFeeSettings } from '@/hooks/use-platform-fees';
import { useI18n } from '@/context/i18n-context';

const createTransferSchema = (t: (key: string) => string) => z.object({
  recipientUsername: z.string().min(2, t('transferPage.schemaRecipientRequired')),
  crypto: z.string().min(1, t('transferPage.schemaCryptoRequired')),
  amount: z.coerce.number().positive(t('transferPage.schemaAmountPositive')),
  totpCode: z.string().optional(),
});

type TransferFormValues = z.infer<ReturnType<typeof createTransferSchema>>;

export default function TransferPage() {
  const { user: authUser, profile, isUserLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const transferSchema = useMemo(() => createTransferSchema(t), [t]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [balances, setBalances] = useState<{ [key in CryptoCurrency]?: { balance: number; lockedBalance: number } }>({});
  const [, setSelectedTransfer] = useState<CoinTransfer | null>(null);
  const [, setIsDetailsOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [is2faEnabledState, setIs2faEnabledState] = useState<boolean | null>(null);
  const { fees: platformFees, isLoading: isFeeSettingsLoading, error: feeSettingsError } = usePlatformFeeSettings();

  // Directly check 2FA status from Supabase profiles table
  useEffect(() => {
    if (authUser?.uid) {
      const check2FA = async () => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
            .or(`id.eq.${authUser.uid},user_id.eq.${authUser.uid}`)
            .maybeSingle();
          if (data) {
            const has2fa = Boolean(
              data.is_2fa_enabled === true ||
              data.is_2fa_enabled === 'true' ||
              data.is_mfa_enabled === true ||
              data.is_mfa_enabled === 'true' ||
              data.two_factor_enabled === true ||
              data.two_factor_enabled === 'true'
            );
            setIs2faEnabledState(has2fa);
          }
        } catch (e) {
          console.warn('Transfer page 2FA check error:', e);
        }
      };
      check2FA();
    }
  }, [authUser?.uid]);

  const is2faActive = Boolean(
    is2faEnabledState ?? (profile?.is_2fa_enabled || profile?.is_mfa_enabled)
  );
  const isSenderTier2 = Boolean(
    profile?.is_verified === true ||
    profile?.id_verified === true ||
    profile?.is_id_verified === true ||
    ['approved', 'verified'].includes(String(profile?.kyc_status || '').toLowerCase().trim()) ||
    ['2', 'tier_2', 'tier2'].includes(String(profile?.verification_tier || '').toLowerCase().trim())
  );
  const isSenderRestricted = Boolean(
    profile?.is_banned ||
    profile?.is_restricted ||
    profile?.account_status === 'suspended' ||
    profile?.account_status === 'banned' ||
    profile?.account_status === 'restricted'
  );

  useEffect(() => {
    if (!isAuthLoading && !authUser) router.push('/login');
  }, [authUser, isAuthLoading, router]);

  const loadBalances = useCallback(async () => {
    if (!authUser?.uid) return;
    try {
      const bal = await getUserWalletBalances(authUser.uid);
      if (bal) setBalances(bal);
    } catch (err) {
      console.warn('Failed to load user balances for transfer:', err);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { recipientUsername: '', crypto: 'BTC', amount: 0, totpCode: '' },
  });

  const watchedCrypto = form.watch('crypto') as CryptoCurrency;
  const availableBalance = useMemo(() => {
    if (!watchedCrypto || !balances[watchedCrypto]) return 0;
    return balances[watchedCrypto]?.balance || 0;
  }, [watchedCrypto, balances]);

  const recipientUsernameValue = form.watch('recipientUsername');
  const watchedAmount = Number(form.watch('amount') || 0);

  const feeRate = platformFees ? platformFees.platformFeePercent / 100 : 0;
  const feeAmount = useMemo(() => {
    if (isNaN(watchedAmount) || watchedAmount <= 0) return 0;
    return Number((watchedAmount * feeRate).toFixed(8));
  }, [watchedAmount, feeRate]);

  const totalDeduction = useMemo(() => {
    if (isNaN(watchedAmount) || watchedAmount <= 0) return 0;
    return Number((watchedAmount + feeAmount).toFixed(8));
  }, [watchedAmount, feeAmount]);

  const maxTransferableAmount = useMemo(() => {
    if (!platformFees || availableBalance <= 0) return 0;
    return Number((availableBalance / (1 + feeRate)).toFixed(8));
  }, [availableBalance, feeRate, platformFees]);

  useEffect(() => {
    let active = true;
    if (recipientUsernameValue && recipientUsernameValue.trim().length >= 2) {
      const timeout = setTimeout(async () => {
        try {
          const res = await fetch(`/api/users/search?q=${encodeURIComponent(recipientUsernameValue.trim())}`);
          if (res.ok) {
            const data = await res.json();
            if (active && data?.users) {
              setSearchResults(data.users);
            }
          }
        } catch (err) {
          console.error('Error searching users:', err);
        }
      }, 250);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    } else {
      setSearchResults([]);
    }
  }, [recipientUsernameValue]);

  async function onSubmit(values: TransferFormValues) {
    if (!authUser?.uid) return;
    if (isSenderRestricted) {
      toast({
        variant: 'destructive',
        title: t('transferPage.accountRestrictedTitle'),
        description: t('transferPage.accountRestrictedDescription'),
      });
      return;
    }
    if (isFeeSettingsLoading || !platformFees) {
      toast({
        variant: 'destructive',
        title: t('transferPage.unavailableTitle'),
        description: feeSettingsError || t('transferPage.feeSettingsUnverified'),
      });
      return;
    }
    setIsProcessing(true);

    const requiredTotal = Number((values.amount * (1 + feeRate)).toFixed(8));
    if (requiredTotal > availableBalance) {
      form.setError('amount', {
        message: t('transferPage.insufficientBalance').replace('{total}', requiredTotal.toFixed(8)).replace('{asset}', String(watchedCrypto)).replace('{feePercent}', platformFees.platformFeePercent.toFixed(2)).replace('{feeAmount}', feeAmount.toFixed(8)).replace('{available}', availableBalance.toFixed(8)),
      });
      setIsProcessing(false);
      return;
    }

    if (is2faActive && (!values.totpCode || values.totpCode.trim().length < 4 || values.totpCode.trim().length > 8)) {
      form.setError('totpCode', { message: t('transferPage.validOtp') });
      setIsProcessing(false);
      return;
    }

    try {
      const transferId = await sendCoinToUser(
        { uid: authUser.uid, displayName: profile?.username || authUser.displayName || 'User' },
        values.recipientUsername,
        values.crypto as CryptoCurrency,
        values.amount,
        values.totpCode?.trim()
      );

      toast({
        title: t('transferPage.completedTitle'),
        description: t('transferPage.successDescription').replace('{amount}', String(values.amount)).replace('{asset}', String(values.crypto)).replace('{username}', values.recipientUsername.replace(/^@/, '')).replace('{feePercent}', platformFees.platformFeePercent.toFixed(2)).replace('{feeAmount}', feeAmount.toFixed(8)).replace('{total}', requiredTotal.toFixed(8)).replace('{id}', String(transferId)),
      });

      form.reset({ recipientUsername: '', crypto: values.crypto, amount: 0, totpCode: '' });
      setSearchResults([]);
      await loadBalances();
      setHistoryKey((prev) => prev + 1);
    } catch (error: any) {
      const msg = error.message || t('transferPage.couldNotComplete');
      if (msg.toLowerCase().includes('totp') || msg.toLowerCase().includes('2fa') || msg.toLowerCase().includes('authenticator')) {
        setIs2faEnabledState(true);
      }
      toast({
        variant: 'destructive',
        title: t('transferPage.failedTitle'),
        description: msg,
      });
    } finally {
      setIsProcessing(false);
    }
  }

  if (isAuthLoading || !authUser) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">{t('transferPage.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isFeeSettingsLoading
              ? t('transferPage.loadingFees')
              : platformFees
              ? t('transferPage.feeDescription').replace('{fee}', platformFees.platformFeePercent.toFixed(2))
              : t('transferPage.unavailableFee')}
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-2 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t('transferPage.sendCoins')}</CardTitle>
            <CardDescription className="text-xs">
              {t('transferPage.sendCoinsDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSenderRestricted && (
              <div className="p-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
                <span>{t('transferPage.restrictedBanner')}</span>
              </div>
            )}
            {!isSenderTier2 && (
              <div className="p-3 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-semibold flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>{t('transferPage.kycRequired')}</span>
                </div>
                <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline text-xs">
                  {t('transferPage.completeKycTier2')}
                </Link>
              </div>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="recipientUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">{t('transferPage.recipientUsername')}</FormLabel>
                      <FormControl>
                        <Input
                          id="recipient-username-input"
                          placeholder={t('transferPage.searchUsername')}
                          {...field}
                          disabled={isSenderRestricted || !isSenderTier2}
                          autoComplete="off"
                          className="font-medium"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {searchResults.length > 0 && (
                  <div className="border rounded-xl max-h-48 overflow-y-auto bg-card divide-y divide-border shadow-md">
                    {searchResults.map((user) => {
                      const isRecipientRestricted = Boolean(
                        user.is_banned ||
                        user.is_restricted ||
                        user.account_status === 'suspended' ||
                        user.account_status === 'banned' ||
                        user.account_status === 'restricted'
                      );
                      return (
                        <div
                          key={user.id}
                          className={`p-2.5 flex items-center justify-between gap-2.5 transition-colors ${
                            isRecipientRestricted
                              ? 'opacity-60 bg-muted/40 cursor-not-allowed'
                              : 'cursor-pointer hover:bg-muted/70'
                          }`}
                          onClick={() => {
                            if (isRecipientRestricted) {
                              toast({
                                variant: 'destructive',
                                title: t('transferPage.recipientRestrictedTitle'),
                                description: t('transferPage.recipientRestrictedDesc').replace('{username}', String(user.username)),
                              });
                              return;
                            }
                            form.setValue('recipientUsername', user.username);
                            setSearchResults([]);
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar className="h-7 w-7">
                              <AvatarImage src={user.avatar_url || user.photo_url} />
                              <AvatarFallback className="text-[10px] font-bold">
                                {(user.username || 'U').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-semibold text-xs text-foreground">@{user.username}</span>
                          </div>
                          {isRecipientRestricted && (
                            <span className="text-[10px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20">
                              {t('transferPage.recipientRestrictedBadge')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="crypto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">{t('transferPage.selectCoin')}</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger id="transfer-crypto-select" className="h-10">
                            <div className="flex items-center gap-2">
                              <CoinBadgeLogo coin={field.value} className="h-5 w-5 shrink-0" />
                              <span className="font-semibold text-xs">{field.value}</span>
                            </div>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CRYPTOS.map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              <div className="flex items-center gap-2">
                                <CoinBadgeLogo coin={c.name} className="h-5 w-5 shrink-0" />
                                <span className="font-bold text-xs">{c.symbol}</span>
                                <span className="text-xs text-muted-foreground font-normal">({c.name})</span>
                              </div>
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
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel className="text-xs font-semibold">{t('transferPage.transferAmount')}</FormLabel>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => form.setValue('amount', maxTransferableAmount)}
                            className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                            title={t('transferPage.maxFeeTitle').replace('{fee}', platformFees?.platformFeePercent.toFixed(2) ?? '-')}
                          >
                            {t('transferPage.maxFeeButton').replace('{fee}', platformFees?.platformFeePercent.toFixed(2) ?? '-').replace('{amount}', maxTransferableAmount.toFixed(8)).replace('{asset}', watchedCrypto)}
                          </button>
                        </div>
                      </div>
                      <FormControl>
                        <Input
                          id="transfer-amount-input"
                          type="number"
                          step="any"
                          placeholder={t('transferPage.amountPlaceholder')}
                          {...field}
                          className="font-mono text-sm"
                        />
                      </FormControl>
                      <FormDescription className="text-[11px]">
                        {t('transferPage.availableInWallet')} <span className="font-mono font-bold text-foreground">{availableBalance.toFixed(8)} {watchedCrypto}</span>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Transfer breakdown uses the current admin-configured percentage. */}
                <div className="rounded-xl border border-border bg-secondary/50 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-muted-foreground">{t('transferPage.breakdownTransferAmount')}</span>
                    <span className="font-mono font-semibold text-foreground">
                      {watchedAmount > 0 ? watchedAmount.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="flex items-center justify-between font-medium">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <span>{t('transferPage.platformFee')}</span>
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                        {platformFees ? `${platformFees.platformFeePercent.toFixed(2)}%` : "-"}
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {feeAmount > 0 ? feeAmount.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <span className="font-bold text-foreground">{t('transferPage.totalWalletDeduction')}</span>
                    <span className="font-mono font-bold text-foreground">
                      {totalDeduction > 0 ? totalDeduction.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                    <span>{t('transferPage.recipientReceives')}</span>
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {watchedAmount > 0 ? watchedAmount.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>
                </div>

                {/* Conditional 2FA Prompt - Only shown if 2FA is active */}
                {is2faActive && (
                  <FormField
                    control={form.control}
                    name="totpCode"
                    render={({ field }) => (
                      <FormItem className="pt-1">
                        <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                          <span>{t('transferPage.authenticatorCode')}</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            id="transfer-totp-input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={8}
                            placeholder={t('transferPage.otpPlaceholder')}
                            {...field}
                            value={field.value || ''}
                            className="font-mono text-center text-base tracking-widest bg-background"
                          />
                        </FormControl>
                        <FormDescription className="text-[11px]">
                          {t('transferPage.twoFactorHelp')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <Button
                  id="submit-transfer-btn"
                  type="submit"
                  className="w-full font-bold text-xs h-10 mt-2 cursor-pointer"
                  disabled={
                    isProcessing ||
                    isFeeSettingsLoading ||
                    !platformFees ||
                    (is2faActive && (!form.watch('totpCode') || form.watch('totpCode')!.trim().length < 4))
                  }
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      <span>{t('transferPage.processing')}</span>
                    </>
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  <span>
                    {watchedAmount > 0
                      ? t('transferPage.sendWithAmount').replace('{amount}', String(watchedAmount)).replace('{asset}', String(watchedCrypto)).replace('{total}', totalDeduction.toFixed(8)).replace('{feePercent}', platformFees?.platformFeePercent.toFixed(2) || '-')
                      : t('transferPage.sendNow').replace('{asset}', String(watchedCrypto))}
                  </span>
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold">{t('transferPage.historyTitle')}</CardTitle>
            <CardDescription className="text-xs">
              {t('transferPage.historyDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="received" key={historyKey}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="received" className="text-xs">{t('transferPage.received')}</TabsTrigger>
                <TabsTrigger value="sent" className="text-xs">{t('transferPage.sent')}</TabsTrigger>
              </TabsList>
              <TabsContent value="received" className="mt-4">
                <TransferHistoryTable
                  userId={authUser.uid}
                  type="received"
                  onRowClick={(t) => {
                    setSelectedTransfer(t);
                    setIsDetailsOpen(true);
                  }}
                />
              </TabsContent>
              <TabsContent value="sent" className="mt-4">
                <TransferHistoryTable
                  userId={authUser.uid}
                  type="sent"
                  onRowClick={(t) => {
                    setSelectedTransfer(t);
                    setIsDetailsOpen(true);
                  }}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
