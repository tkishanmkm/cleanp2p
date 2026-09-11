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

  const is2faActive = Boolean(profile?.is_2fa_enabled || profile?.is_mfa_enabled);

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

  useEffect(() => {
    let active = true;
    if (recipientUsernameValue && recipientUsernameValue.length >= 2) {
      const timeout = setTimeout(async () => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id, username, avatar_url, photo_url')
            .ilike('username', `%${recipientUsernameValue.replace(/^@/, '')}%`)
            .neq('id', authUser?.uid || '')
            .limit(5);

          if (active && data) {
            setSearchResults(data);
          }
        } catch (err) {
          console.error('Error searching users:', err);
        }
      }, 300);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    } else {
      setSearchResults([]);
    }
  }, [recipientUsernameValue, authUser?.uid]);

  async function onSubmit(values: TransferFormValues) {
    if (!authUser?.uid) return;
    setIsProcessing(true);

    if (values.amount > availableBalance) {
      form.setError('amount', { message: `Amount exceeds available balance (${availableBalance.toFixed(8)} ${watchedCrypto}).` });
      setIsProcessing(false);
      return;
    }

    if (is2faActive && (!values.totpCode || values.totpCode.trim().length < 6)) {
      form.setError('totpCode', { message: 'Please enter your 6-digit Authenticator code.' });
      setIsProcessing(false);
      return;
    }

    try {
      const transferId = await sendCoinToUser(
        { uid: authUser.uid, displayName: profile?.username || authUser.displayName || 'User' },
        values.recipientUsername,
        values.crypto as CryptoCurrency,
        values.amount,
        values.totpCode
      );

      toast({
        title: 'Transfer Completed!',
        description: `Successfully sent ${values.amount} ${values.crypto} to @${values.recipientUsername.replace(/^@/, '')}. (ID: ${transferId})`,
      });

      form.reset({ recipientUsername: '', crypto: values.crypto, amount: 0, totpCode: '' });
      setSearchResults([]);
      await loadBalances();
      setHistoryKey((prev) => prev + 1);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Transfer Failed',
        description: error.message || 'Could not complete transfer.',
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
            Instant zero-fee internal transfers between Paxones user accounts.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-2 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold">Send Coins</CardTitle>
            <CardDescription className="text-xs">
              Transfer cryptocurrency instantly to any registered trader username.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                          placeholder="Search username (e.g. Satoshi)"
                          {...field}
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
                    {searchResults.map((user) => (
                      <div
                        key={user.id}
                        className="p-2.5 flex items-center gap-2.5 cursor-pointer hover:bg-muted/70 transition-colors"
                        onClick={() => {
                          form.setValue('recipientUsername', user.username);
                          setSearchResults([]);
                        }}
                      >
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={user.avatar_url || user.photo_url} />
                          <AvatarFallback className="text-[10px] font-bold">
                            {(user.username || 'U').slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-semibold text-xs text-foreground">@{user.username}</span>
                      </div>
                    ))}
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
                            <SelectValue placeholder="Select coin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CRYPTOS.map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name} ({c.symbol})
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
                        <FormLabel className="text-xs font-semibold">Amount</FormLabel>
                        <button
                          type="button"
                          onClick={() => form.setValue('amount', availableBalance)}
                          className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                        >
                          Max: {availableBalance.toFixed(8)} {watchedCrypto}
                        </button>
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

                {/* Conditional 2FA Prompt - Only shown if 2FA is active */}
                {is2faActive && (
                  <FormField
                    control={form.control}
                    name="totpCode"
                    render={({ field }) => (
                      <FormItem className="pt-1">
                        <FormLabel className="text-xs font-semibold flex items-center gap-1.5 text-primary">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                          <span>Authenticator 6-Digit Code</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            id="transfer-totp-input"
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            placeholder="Enter 6-digit TOTP code"
                            {...field}
                            className="font-mono text-center text-base tracking-widest"
                          />
                        </FormControl>
                        <FormDescription className="text-[11px]">
                          Your account has 2FA enabled. Enter the code from your Authenticator app.
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
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  <span>Send {watchedCrypto} Now</span>
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
