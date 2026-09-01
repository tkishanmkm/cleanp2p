'use client';

import { useMemo, useEffect, useState } from 'react';
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
import { Loader2 } from 'lucide-react';
import { CryptoCurrency, CoinTransfer } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';

const transferSchema = z.object({
  recipientUsername: z.string().min(3, 'Recipient User ID is required.'),
  crypto: z.string().min(1, 'Please select a cryptocurrency.'),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  password: z.string().min(1, 'Password required.'),
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

  useEffect(() => {
    if (!isAuthLoading && !authUser) router.push('/login');
  }, [authUser, isAuthLoading, router]);

  useEffect(() => {
    async function loadBalances() {
      if (!authUser?.uid) return;
      try {
        const bal = await getUserWalletBalances(authUser.uid);
        if (bal) setBalances(bal);
      } catch (err) {
        console.warn('Failed to load user balances for transfer:', err);
      }
    }
    loadBalances();
  }, [authUser?.uid]);

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { recipientUsername: '', crypto: 'BTC', amount: 0, password: '' },
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
            .select('id, username, photo_url')
            .ilike('username', `%${recipientUsernameValue}%`)
            .neq('id', authUser?.uid || '')
            .limit(5);

          if (active && data) {
            setSearchResults(data);
          }
        } catch (err) {
          console.error('Error searching users:', err);
        }
      }, 400);
      return () => {
        active = false;
        clearTimeout(timeout);
      };
    } else {
      setSearchResults([]);
    }
  }, [recipientUsernameValue, authUser?.uid]);

  async function onSubmit(values: TransferFormValues) {
    if (!authUser?.email) return;
    setIsProcessing(true);

    if (values.amount > availableBalance) {
      form.setError('amount', { message: 'Amount exceeds available balance.' });
      setIsProcessing(false);
      return;
    }

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: authUser.email,
        password: values.password,
      });

      if (authError) {
        throw new Error('Invalid password. Authentication failed.');
      }

      const transferId = await sendCoinToUser(
        { uid: authUser.uid, displayName: profile?.username || authUser.displayName || 'User' },
        values.recipientUsername,
        values.crypto as CryptoCurrency,
        values.amount
      );

      toast({ title: 'Transfer Successful!', description: `Transaction ID: ${transferId}` });
      form.reset();
      setSearchResults([]);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Transfer Failed', description: error.message });
    } finally {
      setIsProcessing(false);
    }
  }

  if (isAuthLoading || !authUser) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">Transfer Coins</h1>
      </div>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Send to User</CardTitle>
            <CardDescription>Directly send coins to another username or User ID.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="recipientUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipient Username</FormLabel>
                      <FormControl>
                        <Input placeholder="Search recipient username" {...field} autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {searchResults.length > 0 && (
                  <div className="border rounded-md max-h-48 overflow-y-auto">
                    {searchResults.map((user) => (
                      <div
                        key={user.id}
                        className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted"
                        onClick={() => {
                          form.setValue('recipientUsername', user.username);
                          setSearchResults([]);
                        }}
                      >
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.photo_url} />
                          <AvatarFallback>{(user.username || 'U').slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-sm">{user.username}</span>
                      </div>
                    ))}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="crypto"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Coin</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select coin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CRYPTOS.map((c) => (
                            <SelectItem key={c.name} value={c.name}>
                              {c.name}
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
                      <FormLabel>Amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" {...field} />
                      </FormControl>
                      <FormDescription>
                        Available: {availableBalance.toFixed(8)} {watchedCrypto}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="Account password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isProcessing}>
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send Coins
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Transfer History</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="received">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="received">Received</TabsTrigger>
                <TabsTrigger value="sent">Sent</TabsTrigger>
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
