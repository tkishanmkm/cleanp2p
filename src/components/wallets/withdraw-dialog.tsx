'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { User, CryptoCurrency } from "@/lib/types";
import { useToast } from '@/hooks/use-toast';
import { Loader2, Fuel, AlertCircle } from 'lucide-react';
import { requestWithdrawal } from '@/lib/wallet';
import { usePrices } from '@/context/price-context';
import { FIXED_WITHDRAWAL_FEES_USD, SUPPORTED_CRYPTOS } from '@/lib/constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '@/components/providers/auth-provider';
import { getCachedGasFees, type NetworkGasFee } from '@/lib/gas-oracle';

const withdrawSchema = z.object({
  address: z.string().min(1, "Recipient address is required."),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  chain: z.string().min(1, "Please select a network."),
});

type WithdrawFormValues = z.infer<typeof withdrawSchema>;

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
  userWallets: User['wallets'] | undefined;
}

export function WithdrawDialog({ open, onOpenChange, asset, userWallets }: WithdrawDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isGasLoading, setIsGasLoading] = useState(false);
  const [gasFeeData, setGasFeeData] = useState<NetworkGasFee | null>(null);
  const { prices, isLoading: arePricesLoading } = usePrices();

  const availableChains = useMemo(() => {
    if (!asset) return [];
    return SUPPORTED_CRYPTOS.find(c => c.name === asset)?.chains || [];
  }, [asset]);

  const form = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: {
      address: '',
      amount: undefined,
      chain: '',
    },
  });

  const watchedAmount = form.watch('amount') || 0;
  const watchedChain = form.watch('chain');

  // Fetch dynamic live gas fees whenever asset or network changes
  const fetchGasEstimate = useCallback(async (cryptoCode: string, networkCode: string) => {
    if (!cryptoCode || !networkCode) return;
    setIsGasLoading(true);
    try {
      // 1. Try fetching via API route
      const res = await fetch(`/api/internal/gas-oracle?crypto=${encodeURIComponent(cryptoCode)}&network=${encodeURIComponent(networkCode)}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.gasFees) {
          setGasFeeData(data.gasFees);
          return;
        }
      }
      // 2. Fallback to client-side cached gas oracle function
      const fallbackFee = await getCachedGasFees(cryptoCode, networkCode);
      if (fallbackFee) {
        setGasFeeData(fallbackFee);
      }
    } catch (err) {
      console.error('Failed to load dynamic gas fee estimate:', err);
    } finally {
      setIsGasLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      const defaultChain = availableChains.length === 1 ? availableChains[0] : "";
      form.reset({
        address: '',
        amount: undefined,
        chain: defaultChain,
      });
      setGasFeeData(null);
      if (asset && defaultChain) {
        fetchGasEstimate(asset, defaultChain);
      }
    }
  }, [open, availableChains, asset, form, fetchGasEstimate]);

  useEffect(() => {
    if (asset && watchedChain) {
      fetchGasEstimate(asset, watchedChain);
    }
  }, [asset, watchedChain, fetchGasEstimate]);

  const availableBalance = useMemo(() => {
    if (!asset || !userWallets) return 0;
    return userWallets[asset]?.balance || 0;
  }, [asset, userWallets]);

  // Compute estimated network gas fee
  const { feeInCrypto, feeInUsd } = useMemo(() => {
    if (!asset || !watchedChain) return { feeInCrypto: 0, feeInUsd: 0 };

    // Prefer live gas oracle estimate
    if (gasFeeData?.estimated_fee_native) {
      const nativeFee = gasFeeData.estimated_fee_native;
      const usdFee = gasFeeData.estimated_fee_usd || (prices[asset] ? nativeFee * prices[asset] : 0);
      return { feeInCrypto: nativeFee, feeInUsd: usdFee };
    }

    // Fallback to static lookup
    const key = `${asset}-${watchedChain}`;
    const usdFee = FIXED_WITHDRAWAL_FEES_USD[key] || FIXED_WITHDRAWAL_FEES_USD[asset] || 0;
    const price = prices[asset] || 0;
    const cryptoFee = price > 0 ? usdFee / price : 0;
    return { feeInCrypto: cryptoFee, feeInUsd: usdFee };
  }, [asset, watchedChain, gasFeeData, prices]);

  const totalDeducted = useMemo(() => {
    return (watchedAmount || 0) + feeInCrypto;
  }, [watchedAmount, feeInCrypto]);

  const isInsufficientBalance = useMemo(() => {
    if (!watchedAmount) return false;
    return totalDeducted > availableBalance;
  }, [watchedAmount, totalDeducted, availableBalance]);

  // Set maximum withdrawable amount (Balance - Estimated Gas Fee)
  const handleSetMaxAmount = () => {
    const maxAmount = Math.max(0, availableBalance - feeInCrypto);
    form.setValue('amount', Number(maxAmount.toFixed(8)));
  };

  async function onSubmit(values: WithdrawFormValues) {
    if (!user || !asset) return;

    if (totalDeducted > availableBalance) {
      form.setError("amount", {
        message: `Insufficient balance to cover withdrawal (${values.amount} ${asset}) + network gas fee (${feeInCrypto.toFixed(6)} ${asset}).`,
      });
      return;
    }

    setIsLoading(true);
    try {
      const appUser = { id: user.id || user.uid, displayName: user.displayName || "" };
      await requestWithdrawal(
        appUser,
        asset,
        values.chain,
        values.amount,
        values.address,
        feeInCrypto
      );

      toast({
        title: "Withdrawal Requested",
        description: `Your withdrawal of ${values.amount} ${asset} has been submitted for processing.`,
      });
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to process withdrawal.";
      toast({
        variant: 'destructive',
        title: "Withdrawal Failed",
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Withdraw {asset}</span>
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="chain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Network</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select network" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableChains.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
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
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={`Enter destination ${watchedChain || asset || ''} address`}
                      className="font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
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
                  <div className="relative">
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        placeholder="0.00"
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-xs font-semibold text-primary hover:text-primary/80"
                      onClick={handleSetMaxAmount}
                    >
                      Max
                    </Button>
                  </div>
                  <div className="flex justify-between items-center text-xs text-muted-foreground pt-1">
                    <span>Available: {availableBalance.toFixed(8)} {asset}</span>
                    {prices[asset || ''] ? (
                      <span>≈ ${(availableBalance * (prices[asset || ''] || 0)).toFixed(2)} USD</span>
                    ) : null}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Dynamic Live Gas Oracle & Fee Breakdown */}
            <div className="p-3 bg-muted/60 border border-border/50 rounded-lg text-xs space-y-2">
              <div className="flex justify-between items-center text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium">
                  <Fuel className="h-3.5 w-3.5 text-primary" />
                  Estimated Network Gas Fee:
                </span>
                <span className="font-mono flex items-center gap-1">
                  {isGasLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <span>{feeInCrypto > 0 ? feeInCrypto.toFixed(6) : '0.00'} {asset}</span>
                      {feeInUsd > 0 && (
                        <span className="text-[10px] text-muted-foreground">(${feeInUsd.toFixed(2)})</span>
                      )}
                    </>
                  )}
                </span>
              </div>

              {gasFeeData?.sat_per_vbyte && (
                <div className="flex justify-between text-[11px] text-muted-foreground/80 pl-5">
                  <span>Mempool Rate:</span>
                  <span>{gasFeeData.sat_per_vbyte} sat/vB</span>
                </div>
              )}

              {gasFeeData?.base_fee_gwei && (
                <div className="flex justify-between text-[11px] text-muted-foreground/80 pl-5">
                  <span>EVM Gas Price:</span>
                  <span>{(gasFeeData.base_fee_gwei + (gasFeeData.priority_fee_gwei || 0)).toFixed(1)} Gwei</span>
                </div>
              )}

              <div className="border-t border-border/40 pt-2 flex justify-between items-center font-medium">
                <span>Total Balance Deducted:</span>
                <span className="font-mono text-foreground font-semibold">
                  {totalDeducted > 0 ? totalDeducted.toFixed(6) : '0.00'} {asset}
                </span>
              </div>

              <div className="flex justify-between items-center text-muted-foreground">
                <span>You Will Receive:</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {Math.max(0, watchedAmount).toFixed(6)} {asset}
                </span>
              </div>
            </div>

            {isInsufficientBalance && (
              <div className="flex items-start gap-2 p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Insufficient balance. Total deduction ({totalDeducted.toFixed(6)} {asset}) exceeds available balance ({availableBalance.toFixed(6)} {asset}).
                </span>
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || isInsufficientBalance || !watchedAmount || watchedAmount <= 0 || !watchedChain}
              className="w-full"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Withdrawal
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
