'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { User, UserWallet, CryptoCurrency } from "@/lib/types";
import { useFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { createWithdrawalRequest } from '@/lib/wallet';
import { usePrices } from '@/context/price-context';
import { FIXED_WITHDRAWAL_FEES_USD, SUPPORTED_CRYPTOS } from '@/lib/constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';

const withdrawSchema = z.object({
  address: z.string().min(1, "Recipient address is required."),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  chain: z.string().min(1, "Please select a network."),
  password: z.string().min(1, "Password required for security."),
});

type WithdrawFormValues = z.infer<typeof withdrawSchema>;

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
  userWallets: User['wallets'] | undefined;
}

export function WithdrawDialog({ open, onOpenChange, asset, userWallets }: WithdrawDialogProps) {
  const { firestore, user, auth } = useFirebase();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { prices, isLoading: arePricesLoading } = usePrices();

  const availableChains = useMemo(() => {
    if (!asset) return [];
    return SUPPORTED_CRYPTOS.find(c => c.name === asset)?.chains || [];
  }, [asset]);

  const form = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawSchema),
  });

  useEffect(() => {
    if (open) {
        form.reset({
            address: '',
            amount: undefined,
            chain: availableChains.length === 1 ? availableChains[0] : "",
            password: '',
        });
    }
  }, [open, availableChains, form]);
  
  const watchedAmount = form.watch('amount');
  const watchedChain = form.watch('chain');

  const availableBalance = useMemo(() => {
    if (!asset || !userWallets) return 0;
    return userWallets[asset]?.balance || 0;
  }, [asset, userWallets]);

  const { feeInCrypto } = useMemo(() => {
    if (!asset || arePricesLoading || !watchedChain) return { feeInCrypto: 0 };
    const key = `${asset}-${watchedChain}`;
    const usdFee = FIXED_WITHDRAWAL_FEES_USD[key] || FIXED_WITHDRAWAL_FEES_USD[asset] || 0;
    const price = prices[asset];
    return { feeInCrypto: price > 0 ? usdFee / price : 0 };
  }, [asset, arePricesLoading, watchedChain, prices]);

  async function onSubmit(values: WithdrawFormValues) {
    if (!user || !asset || !auth?.currentUser?.email) return;
    if (values.amount > availableBalance) {
      form.setError("amount", { message: "Insufficient balance." });
      return;
    }
    
    setIsLoading(true);
    try {
      const credential = EmailAuthProvider.credential(auth.currentUser.email, values.password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      const appUser = { id: user.uid, userId: user.displayName || "" } as User;
      await createWithdrawalRequest(firestore, appUser, asset, values.chain, values.amount, values.address, feeInCrypto);
      toast({ title: "Requested", description: "Withdrawal is awaiting approval." });
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: "Failed", description: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Withdraw {asset}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="chain" render={({ field }) => (
                <FormItem>
                    <FormLabel>Network</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue placeholder="Select network" /></SelectTrigger></FormControl>
                        <SelectContent>{availableChains.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )} />
            <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                    <FormLabel>Recipient Address</FormLabel>
                    <FormControl><Input placeholder="Destination address" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
            )} />
            <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                    <FormLabel>Amount</FormLabel>
                    <div className="relative">
                        <FormControl><Input type="number" step="any" {...field} /></FormControl>
                        <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => form.setValue('amount', availableBalance)}>Max</Button>
                    </div>
                    <FormDescription>Available: {availableBalance.toFixed(8)} {asset}</FormDescription>
                    <FormMessage />
                </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
            )} />
            <div className="p-3 bg-secondary/50 rounded-md text-sm space-y-1">
                <div className="flex justify-between"><span>Fee:</span><span>{feeInCrypto.toFixed(8)} {asset}</span></div>
                <div className="flex justify-between font-semibold"><span>You receive:</span><span>{Math.max(0, (watchedAmount || 0) - feeInCrypto).toFixed(8)} {asset}</span></div>
            </div>
            <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Withdrawal
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
