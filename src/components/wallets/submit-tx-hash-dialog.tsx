'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import QRCode from 'qrcode.react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

import type { Deposit } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { useCountdown } from '@/hooks/use-countdown';
import { confirmDepositWithTxId } from '@/lib/wallet';

import { Copy, AlertTriangle, Loader2 } from 'lucide-react';

const formSchema = z.object({
  txId: z.string().min(10, 'Please enter a valid transaction hash.'),
});

type FormValues = z.infer<typeof formSchema>;

interface SubmitTxHashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deposit: Deposit | null;
}

export function SubmitTxHashDialog({ open, onOpenChange, deposit }: SubmitTxHashDialogProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const countdown = useCountdown(deposit?.timerEnd || 0);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
  });

  useEffect(() => {
    // Reset form when dialog is closed or deposit changes
    if (!open) {
      form.reset({ txId: '' });
    }
  }, [open, deposit, form]);

  async function onSubmit(values: FormValues) {
    if (!deposit) return;
    setIsLoading(true);
    try {
      await confirmDepositWithTxId(deposit.id, values.txId);
      toast({ title: 'Transaction Submitted', description: 'Your deposit is now awaiting blockchain confirmation.' });
      onOpenChange(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Submission Failed', description: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  const handleCopy = (text: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    toast({ title: 'Address Copied!' });
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm Your Deposit</DialogTitle>
          <DialogDescription>Submit the blockchain transaction hash (TxID) to proceed.</DialogDescription>
        </DialogHeader>

        {deposit && (
          <div className="space-y-4">
            {countdown.isFinished ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Request Expired</AlertTitle>
                <AlertDescription>
                  This deposit request has expired because the 3-hour payment window has passed. Please create a new
                  deposit request.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="text-center p-2 border rounded-md">
                  <p className="text-sm font-semibold">Time Remaining to Confirm:</p>
                  <p className="text-lg font-mono text-destructive">{`${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`}</p>
                </div>
                <div className="flex flex-col items-center gap-4 my-4">
                  <div className="p-2 bg-white rounded-lg">
                    <QRCode value={deposit.walletAddress} size={160} />
                  </div>
                  <div className="flex items-center gap-1 p-1 bg-muted rounded-md w-full">
                    <p className="font-mono text-xs break-all text-center flex-grow">{deposit.walletAddress}</p>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleCopy(deposit.walletAddress)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="txId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Transaction Hash (TxID)</FormLabel>
                          <FormControl>
                            <Input placeholder="Enter the transaction hash from your wallet" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="submit" disabled={isLoading} className="w-full">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Submit Confirmation
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
