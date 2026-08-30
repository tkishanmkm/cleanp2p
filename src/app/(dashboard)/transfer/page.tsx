'use client';

import { useMemo, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { query, collection, where, limit, getDocs, doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { sendCoinToUser } from '@/lib/wallet';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Send, ArrowUp, ArrowDown, AlertCircle, Copy } from 'lucide-react';
import { CryptoCurrency, User, CoinTransfer } from '@/lib/types';
import { toDate } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { TransferHistoryTable } from '@/components/wallets/transfer-history-table';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';

const transferSchema = z.object({
  recipientUsername: z.string().min(3, 'Recipient User ID is required.'),
  crypto: z.string().min(1, 'Please select a cryptocurrency.'),
  amount: z.coerce.number().positive('Amount must be a positive number.'),
  password: z.string().min(1, "Password required."),
});

type TransferFormValues = z.infer<typeof transferSchema>;

export default function TransferPage() {
  const { firestore, user: authUser, isUserLoading: isAuthLoading, auth } = useFirebase();
  const router = useRouter();
  const { toast } = useToast();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

  const [selectedTransfer, setSelectedTransfer] = useState<CoinTransfer | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && !authUser) router.push('/login');
  }, [authUser, isAuthLoading, router]);

  const userRef = useMemoFirebase(() => (authUser ? doc(firestore, 'users', authUser.uid) : null), [authUser, firestore]);
  const { data: userData } = useDoc<User>(userRef);

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { password: "" }
  });

  const watchedCrypto = form.watch('crypto');
  const availableBalance = useMemo(() => {
    if (!watchedCrypto || !userData?.wallets) return 0;
    return userData.wallets[watchedCrypto as CryptoCurrency]?.balance || 0;
  }, [watchedCrypto, userData]);

  const recipientUsernameValue = form.watch('recipientUsername');

  useEffect(() => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    if (recipientUsernameValue && recipientUsernameValue.length >= 2) {
      setIsSearching(true);
      const timeout = setTimeout(async () => {
        if (!firestore) return;
        const q = query(collection(firestore, 'users'), where('userId', '>=', recipientUsernameValue), where('userId', '<=', recipientUsernameValue + '\uf8ff'), limit(5));
        const snapshot = await getDocs(q);
        const users = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as User)).filter(u => u.id !== authUser?.uid);
        setSearchResults(users);
        setIsSearching(false);
      }, 500);
      setDebounceTimeout(timeout as any);
    } else {
      setSearchResults([]);
    }
  }, [recipientUsernameValue, firestore, authUser]);

  async function onSubmit(values: TransferFormValues) {
    if (!firestore || !authUser || !auth || !auth.currentUser?.email) return;
    setIsProcessing(true);

    if (values.amount > availableBalance) {
      form.setError('amount', { message: 'Amount exceeds available balance.' });
      setIsProcessing(false);
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, values.password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      const transferId = await sendCoinToUser(firestore, { uid: authUser.uid, displayName: authUser.displayName }, values.recipientUsername, values.crypto as CryptoCurrency, values.amount);
      toast({ title: 'Transfer Successful!', description: `ID: ${transferId}` });
      form.reset();
      setSearchResults([]);
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Failed', description: error.message });
    } finally {
        setIsProcessing(false);
    }
  }

  if (isAuthLoading || !authUser) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <>
      <div className="flex items-center mb-6"><h1 className="text-lg font-semibold md:text-2xl">Transfer Coins</h1></div>
      <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Send to User</CardTitle><CardDescription>Directly send coins to another User ID.</CardDescription></CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField control={form.control} name="recipientUsername" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipient User ID</FormLabel>
                      <FormControl><Input placeholder="Search user ID" {...field} autoComplete="off" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                 {searchResults.length > 0 && (
                    <div className="border rounded-md max-h-48 overflow-y-auto">
                        {searchResults.map(user => (
                            <div key={user.id} className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted" onClick={() => { form.setValue('recipientUsername', user.userId); setSearchResults([]); }}>
                                <Avatar className="h-8 w-8"><AvatarImage src={user.photoURL} /><AvatarFallback>{user.userId.slice(0,2)}</AvatarFallback></Avatar>
                                <span>{user.userId}</span>
                            </div>
                        ))}
                    </div>
                 )}
                <FormField control={form.control} name="crypto" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Coin</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select coin" /></SelectTrigger></FormControl>
                        <SelectContent>{SUPPORTED_CRYPTOS.map(c => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount</FormLabel>
                      <FormControl><Input type="number" step="any" {...field} /></FormControl>
                      <FormDescription>Available: {availableBalance.toFixed(8)} {watchedCrypto}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl><Input type="password" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isProcessing}>{isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send Coins</Button>
              </form>
            </Form>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="received">
              <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="received">Received</TabsTrigger><TabsTrigger value="sent">Sent</TabsTrigger></TabsList>
              <TabsContent value="received" className="mt-4"><TransferHistoryTable userId={authUser.uid} type="received" onRowClick={(t) => { setSelectedTransfer(t); setIsDetailsOpen(true); }} /></TabsContent>
              <TabsContent value="sent" className="mt-4"><TransferHistoryTable userId={authUser.uid} type="sent" onRowClick={(t) => { setSelectedTransfer(t); setIsDetailsOpen(true); }} /></TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
