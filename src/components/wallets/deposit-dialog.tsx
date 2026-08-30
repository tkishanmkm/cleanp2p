'use client';

import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import QRCode from "qrcode.react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Copy, AlertTriangle, Loader2, Clock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import type { Deposit, CryptoCurrency, DepositAddressSet } from '@/lib/types';
import { createDepositRequest, confirmDepositWithTxId } from '@/lib/wallet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useCountdown } from '@/hooks/use-countdown';
import { Skeleton } from '../ui/skeleton';
import { doc, updateDoc } from 'firebase/firestore';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { isPast } from 'date-fns';
import { toDate } from '@/lib/utils';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { ScrollArea } from '../ui/scroll-area';

const amountSchema = z.object({
  amount: z.coerce.number().positive("Amount must be a positive number."),
  chain: z.string().min(1, "Please select a network."),
});
type AmountFormValues = z.infer<typeof amountSchema>;

const txIdSchema = z.object({
  txId: z.string().min(10, "Please enter a valid transaction hash."),
});
type TxIdFormValues = z.infer<typeof txIdSchema>;

interface DepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
  walletIndex: number | undefined;
  initialDeposit?: Deposit | null;
}

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency, className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

export function DepositDialog({ open, onOpenChange, asset, walletIndex, initialDeposit }: DepositDialogProps) {
  const { toast } = useToast();
  const { firestore, user } = useFirebase();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [createdDeposit, setCreatedDeposit] = useState<Deposit | null>(null);
  const countdown = useCountdown(createdDeposit?.timerEnd || 0);

  const addressSetRef = useMemoFirebase(() => (firestore && walletIndex) ? doc(firestore, "crypto_deposit_addresses", String(walletIndex)) : null, [firestore, walletIndex]);
  const { data: addressSetData, isLoading: isAddressSetLoading } = useDoc<DepositAddressSet>(addressSetRef);

  useEffect(() => {
    if (initialDeposit && open) {
        setCreatedDeposit(initialDeposit);
        setStep(2);
    }
  }, [initialDeposit, open]);

  const availableChains = useMemo(() => {
    if (!asset) return [];
    const supported = SUPPORTED_CRYPTOS.find(c => c.name === asset);
    return supported?.chains || [];
  }, [asset]);

  const amountForm = useForm<AmountFormValues>({
    resolver: zodResolver(amountSchema),
    defaultValues: { chain: availableChains.length === 1 ? availableChains[0] : "" }
  });

  const txIdForm = useForm<TxIdFormValues>({
    resolver: zodResolver(txIdSchema),
  });

  useEffect(() => {
    if (open && availableChains.length === 1) {
        amountForm.setValue('chain', availableChains[0]);
    }
  }, [availableChains, amountForm, open]);

  const handleCreateRequest = async (values: AmountFormValues) => {
    if (!asset || !user || !user.displayName || walletIndex === undefined) return;
    setIsLoading(true);
    try {
      const newDeposit = await createDepositRequest(firestore, user.uid, user.displayName, walletIndex, asset, values.chain, values.amount);
      setCreatedDeposit(newDeposit);
      setStep(2);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    } finally {
      setIsLoading(false);
    }
  };
  
  async function handleTxIdSubmit(values: TxIdFormValues) {
    if (!createdDeposit) return;
    setIsLoading(true);
    try {
      await confirmDepositWithTxId(firestore, createdDeposit.id, values.txId);
      toast({ title: 'Submitted', description: 'Awaiting admin confirmation.' });
      handleOpenChange(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Failed', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setTimeout(() => { setStep(1); setCreatedDeposit(null); amountForm.reset(); txIdForm.reset(); }, 300);
    }
    onOpenChange(isOpen);
  };

  const isRequestExpired = createdDeposit?.status === 'expired' || (createdDeposit && isPast(toDate(createdDeposit.timerEnd)!));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 1 ? (
            <>
            <DialogHeader><DialogTitle>Deposit {asset}</DialogTitle></DialogHeader>
            <Form {...amountForm}>
                <form onSubmit={amountForm.handleSubmit(handleCreateRequest)} className="space-y-4">
                    <FormField control={amountForm.control} name="chain" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Network</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select network" /></SelectTrigger></FormControl>
                                <SelectContent>{availableChains.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={amountForm.control} name="amount" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Amount</FormLabel>
                            <FormControl><Input type="number" step="any" placeholder="0.00" {...field} /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <Button type="submit" disabled={isLoading} className="w-full">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Get Deposit Address
                    </Button>
                </form>
            </Form>
            </>
        ) : (
            <>
                <DialogHeader><DialogTitle>Send {createdDeposit?.crypto}</DialogTitle></DialogHeader>
                {isRequestExpired ? <Alert variant="destructive"><AlertTitle>Expired</AlertTitle><AlertDescription>This request is no longer active.</AlertDescription></Alert> : (
                    <div className="space-y-4">
                        <div className="flex flex-col items-center gap-4">
                            <div className="p-2 bg-white rounded-lg border"><QRCode value={createdDeposit?.walletAddress || ''} size={160} /></div>
                            <div className="text-center">
                                <p className="text-sm font-mono break-all">{createdDeposit?.walletAddress}</p>
                                <Button variant="link" size="sm" onClick={() => { navigator.clipboard.writeText(createdDeposit?.walletAddress || ''); toast({title:'Copied'}); }}>Copy Address</Button>
                            </div>
                        </div>
                        <Form {...txIdForm}>
                            <form onSubmit={txIdForm.handleSubmit(handleTxIdSubmit)} className="space-y-4 border-t pt-4">
                                <FormField control={txIdForm.control} name="txId" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Transaction ID (TxID)</FormLabel>
                                        <FormControl><Input placeholder="Paste TxID here" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <Button type="submit" disabled={isLoading} className="w-full">Confirm Sent</Button>
                            </form>
                        </Form>
                    </div>
                )}
            </>
        )}
      </DialogContent>
    </Dialog>
  );
}
