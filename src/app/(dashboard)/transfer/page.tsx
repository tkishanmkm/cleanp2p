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
import { Loader2, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';
import { CryptoCurrency, CoinTransfer } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { CoinBadgeLogo } from '@/app/(dashboard)/wallets/page';

const transferSchema = z.object({
  recipientUsername: z.string().min(2, 'Recipient username is required.'),
  crypto: z.string().min(1, 'Please select a cryptocurrency.'),
  amount: z.coerce.number().positive('Amount must be greater than 0.'),
  totpCode: z.string().optional(),
});

type TransferFormValues = z.infer<typeof transferSchema>;

export default function TransferPage() {
  const { user: authUser, profile, isUserLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [isProcessing, setIsProcessing] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [balances, setBalances] = useState<{ [key in CryptoCurrency]?: { balance: number; lockedBalance: number } }>({});
  const [, setSelectedTransfer] = useState<CoinTransfer | null>(null);
  const [, setIsDetailsOpen] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [is2faEnabledState, setIs2faEnabledState] = useState<boolean | null>(null);

  // Directly check 2FA status from Supabase profiles table
  useEffect(() => {
    if (authUser?.uid) {
      const check2FA = async () => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret')
            .or(`id.eq.${authUser.uid},user_id.eq.${authUser.uid}`)
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
          console.warn('Transfer page 2FA check error:', e);
        }
      };
      check2FA();
    }
  }, [authUser?.uid]);

  const is2faActive = Boolean(
    is2faEnabledState ?? (profile?.is_2fa_enabled || profile?.is_mfa_enabled)
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

  const feeRate = 0.015; // 1.5% standard internal transfer fee
  const feeAmount = useMemo(() => {
    if (isNaN(watchedAmount) || watchedAmount <= 0) return 0;
    return Number((watchedAmount * feeRate).toFixed(8));
  }, [watchedAmount]);

  const totalDeduction = useMemo(() => {
    if (isNaN(watchedAmount) || watchedAmount <= 0) return 0;
    return Number((watchedAmount + feeAmount).toFixed(8));
  }, [watchedAmount, feeAmount]);

  const maxTransferableAmount = useMemo(() => {
    if (availableBalance <= 0) return 0;
    return Number((availableBalance / (1 + feeRate)).toFixed(8));
  }, [availableBalance]);

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
        title: 'Account Restricted',
        description: 'Your account is restricted or banned. You cannot send transfers.',
      });
      return;
    }
    setIsProcessing(true);

    const requiredTotal = Number((values.amount * 1.015).toFixed(8));
    if (requiredTotal > availableBalance) {
      form.setError('amount', {
        message: `Total required (${requiredTotal.toFixed(8)} ${watchedCrypto} incl. 1.5% fee of ${(values.amount * 0.015).toFixed(8)}) exceeds available balance (${availableBalance.toFixed(8)} ${watchedCrypto}).`
      });
      setIsProcessing(false);
      return;
    }

    if (is2faActive && (!values.totpCode || values.totpCode.trim().length < 4 || values.totpCode.trim().length > 8)) {
      form.setError('totpCode', { message: 'Please enter your 4-8 digit Authenticator OTP code.' });
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
        title: 'Transfer Completed!',
        description: `Successfully sent ${values.amount} ${values.crypto} to @${values.recipientUsername.replace(/^@/, '')} (1.5% Fee: ${(values.amount * 0.015).toFixed(8)} ${values.crypto}). (ID: ${transferId})`,
      });

      form.reset({ recipientUsername: '', crypto: values.crypto, amount: 0, totpCode: '' });
      setSearchResults([]);
      await loadBalances();
      setHistoryKey((prev) => prev + 1);
    } catch (error: any) {
      const msg = error.message || 'Could not complete transfer.';
      if (msg.toLowerCase().includes('totp') || msg.toLowerCase().includes('2fa') || msg.toLowerCase().includes('authenticator')) {
        setIs2faEnabledState(true);
      }
      toast({
        variant: 'destructive',
        title: 'Transfer Failed',
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
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Direct User-to-User Transfer</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Instant internal transfers between PaxOnes user accounts with a standard 1.5% platform & network fee.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-2 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold">Send Coins</CardTitle>
            <CardDescription className="text-xs">
              Transfer cryptocurrency instantly to any registered trader username on PaxOnes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isSenderRestricted && (
              <div className="p-3 mb-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold flex items-center gap-2">
                <span>Your account is restricted or banned. You cannot send or receive cryptocurrency transfers.</span>
              </div>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="recipientUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">Recipient Username</FormLabel>
                      <FormControl>
                        <Input
                          id="recipient-username-input"
                          placeholder="Search username (e.g. quickbot.65)"
                          {...field}
                          disabled={isSenderRestricted}
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
                                title: 'Recipient Restricted',
                                description: `@${user.username} is banned or restricted and cannot receive transfers.`,
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
                              Restricted (Cannot receive)
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
                      <FormLabel className="text-xs font-semibold">Select Coin</FormLabel>
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
                        <FormLabel className="text-xs font-semibold">Transfer Amount</FormLabel>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => form.setValue('amount', maxTransferableAmount)}
                            className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                            title="Calculates max amount you can send so amount + 1.5% fee equals available balance"
                          >
                            Max (incl. 1.5% fee): {maxTransferableAmount.toFixed(8)} {watchedCrypto}
                          </button>
                        </div>
                      </div>
                      <FormControl>
                        <Input
                          id="transfer-amount-input"
                          type="number"
                          step="any"
                          placeholder="0.00"
                          {...field}
                          className="font-mono text-sm"
                        />
                      </FormControl>
                      <FormDescription className="text-[11px]">
                        Available in wallet: <span className="font-mono font-bold text-foreground">{availableBalance.toFixed(8)} {watchedCrypto}</span>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Transfer Breakdown & 1.5% Fee Calculation Display */}
                <div className="rounded-xl border border-border bg-secondary/50 p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-medium">
                    <span className="text-muted-foreground">Transfer Amount</span>
                    <span className="font-mono font-semibold text-foreground">
                      {watchedAmount > 0 ? watchedAmount.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="flex items-center justify-between font-medium">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <span>PaxOnes Platform Fee</span>
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">
                        1.5%
                      </span>
                    </span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {feeAmount > 0 ? feeAmount.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between">
                    <span className="font-bold text-foreground">Total Wallet Deduction</span>
                    <span className="font-mono font-bold text-foreground">
                      {totalDeduction > 0 ? totalDeduction.toFixed(8) : '0.00000000'} {watchedCrypto}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                    <span>Recipient receives</span>
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
                          <span>Authenticator Two-Factor Code</span>
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
                            value={field.value || ''}
                            className="font-mono text-center text-base tracking-widest bg-background"
                          />
                        </FormControl>
                        <FormDescription className="text-[11px]">
                          Two-factor authentication is active on your account. Enter the code from your authenticator app to authorize transfer.
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
                    (is2faActive && (!form.watch('totpCode') || form.watch('totpCode')!.trim().length < 4))
                  }
                >
                  {isProcessing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  <span>
                    {watchedAmount > 0
                      ? `Send ${watchedAmount} ${watchedCrypto} (Total: ${totalDeduction.toFixed(8)} ${watchedCrypto} incl. 1.5% fee)`
                      : `Send ${watchedCrypto} Now`}
                  </span>
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold">Transfer History</CardTitle>
            <CardDescription className="text-xs">
              Direct transfers sent and received on your account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="received" key={historyKey}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="received" className="text-xs">Received</TabsTrigger>
                <TabsTrigger value="sent" className="text-xs">Sent</TabsTrigger>
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
