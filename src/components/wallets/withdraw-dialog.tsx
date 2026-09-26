'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { User, CryptoCurrency } from "@/lib/types";
import { useToast } from '@/hooks/use-toast';
import { Loader2, Fuel, AlertCircle, ShieldCheck } from 'lucide-react';
import { usePrices } from '@/context/price-context';
import { useWallet } from '@/context/wallet-context';
import { FIXED_WITHDRAWAL_FEES_USD, SUPPORTED_CRYPTOS } from '@/lib/constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useAuth } from '@/components/providers/auth-provider';
import { getCachedGasFees, type NetworkGasFee } from '@/lib/gas-oracle';
import { supabase } from '@/lib/supabase/client';

const withdrawSchema = z.object({
  address: z.string().min(1, "Recipient address is required."),
  amount: z.coerce.number().positive("Amount must be a positive number."),
  chain: z.string().min(1, "Please select a network."),
  totpCode: z.string().optional(),
});

type WithdrawFormValues = z.infer<typeof withdrawSchema>;

interface WithdrawDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: CryptoCurrency | null;
  userWallets?: User['wallets'] | undefined;
}

export function WithdrawDialog({ open, onOpenChange, asset, userWallets }: WithdrawDialogProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { requestWithdrawal, refreshBalances, balances } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [isGasLoading, setIsGasLoading] = useState(false);
  const [gasFeeData, setGasFeeData] = useState<NetworkGasFee | null>(null);
  const [is2faEnabledState, setIs2faEnabledState] = useState(false);
  const { prices } = usePrices();

  const is2faActive = useMemo(() => {
    return Boolean(is2faEnabledState || profile?.is_2fa_enabled || profile?.is_mfa_enabled);
  }, [is2faEnabledState, profile]);

  // Check 2FA state from database on open
  useEffect(() => {
    if (open && (user?.uid || user?.id)) {
      const uid = user.uid || user.id;
      const check2FA = async () => {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('is_2fa_enabled, is_mfa_enabled, two_factor_secret')
            .or(`id.eq.${uid},user_id.eq.${uid}`)
            .maybeSingle();
          if (data) {
            setIs2faEnabledState(
              Boolean(
                data.is_2fa_enabled === true ||
                data.is_2fa_enabled === 'true' ||
                data.is_mfa_enabled === true ||
                data.is_mfa_enabled === 'true' ||
                Boolean(data.two_factor_secret && String(data.two_factor_secret).trim().length > 0)
              )
            );
          }
        } catch (e) {
          console.warn('WithdrawDialog 2FA check error:', e);
        }
      };
      check2FA();
    }
  }, [open, user]);

  const availableChains = useMemo(() => {
    if (!asset) return [];
    return SUPPORTED_CRYPTOS.find(c => c.name === asset)?.chains || [];
  }, [asset]);

  const form = useForm<WithdrawFormValues>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: {
      address: '',
      amount: '' as any,
      chain: '',
      totpCode: '',
    },
  });

  const watchedAmount = form.watch('amount');
  const watchedChain = form.watch('chain');

  const numericWatchedAmount = useMemo(() => {
    if (typeof watchedAmount === 'number') return isNaN(watchedAmount) ? 0 : watchedAmount;
    if (typeof watchedAmount === 'string') {
      const parsed = parseFloat(watchedAmount);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }, [watchedAmount]);

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
        amount: '' as any,
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
    if (!asset) return 0;
    if (balances && balances[asset]) {
      return balances[asset].available || 0;
    }
    if (userWallets && userWallets[asset]) {
      return userWallets[asset]?.balance || 0;
    }
    return 0;
  }, [asset, balances, userWallets]);

  // Compute estimated network gas fee
  const { feeInCrypto, feeInUsd } = useMemo(() => {
    if (!asset || !watchedChain) return { feeInCrypto: 0, feeInUsd: 0 };

    // Prefer live gas oracle estimate
    if (gasFeeData?.estimated_fee_usd) {
      const usdFee = Number(gasFeeData.estimated_fee_usd) || 0;
      const assetPrice = Number(prices[asset] || (asset === 'USDT' ? 1.0 : 0));
      const cryptoFee = assetPrice > 0 ? usdFee / assetPrice : (Number(gasFeeData.estimated_fee_native) || 0);
      return { feeInCrypto: Number(cryptoFee.toFixed(6)), feeInUsd: Number(usdFee.toFixed(2)) };
    }

    // Fallback to static lookup
    const key = `${asset}-${watchedChain}`;
    const usdFee = Number(FIXED_WITHDRAWAL_FEES_USD[key] || FIXED_WITHDRAWAL_FEES_USD[asset] || 0);
    const price = Number(prices[asset] || 0);
    const cryptoFee = price > 0 ? usdFee / price : 0;
    return { feeInCrypto: cryptoFee, feeInUsd: usdFee };
  }, [asset, watchedChain, gasFeeData, prices]);

  const totalDeducted = useMemo(() => {
    return Number(numericWatchedAmount || 0) + Number(feeInCrypto || 0);
  }, [numericWatchedAmount, feeInCrypto]);

  const isInsufficientBalance = useMemo(() => {
    if (!numericWatchedAmount || numericWatchedAmount <= 0) return false;
    return totalDeducted > availableBalance;
  }, [numericWatchedAmount, totalDeducted, availableBalance]);

  // Set maximum withdrawable amount (Balance - Estimated Gas Fee)
  const handleSetMaxAmount = () => {
    const maxAmount = Math.max(0, availableBalance - feeInCrypto);
    form.setValue('amount', Number(maxAmount.toFixed(8)));
  };

  async function onSubmit(values: WithdrawFormValues) {
    if (!user || !asset) return;

    const targetAddress = values.address.trim();
    const withdrawAmt = Number(values.amount);

    setIsLoading(true);
    try {
      // If 2FA is active, validate that TOTP code is provided
      if (is2faActive) {
        const cleanTotp = (values.totpCode || '').trim();
        if (!cleanTotp || cleanTotp.length < 4 || cleanTotp.length > 8) {
          form.setError('totpCode', {
            message: 'Please enter your 4-8 digit authenticator OTP code.',
          });
          setIsLoading(false);
          return;
        }
      }

      // Check if the destination address belongs to another registered user on the platform
      const { data: internalDep } = await supabase
        .from('deposit_addresses')
        .select('user_id')
        .eq('address', targetAddress)
        .maybeSingle();

      if (internalDep?.user_id && internalDep.user_id !== user.uid) {
        // Internal transfer detected! Execute instantly via internal transfer API
        const internalTransferKey = globalThis.crypto.randomUUID();
        const transferRes = await fetch('/api/wallet/transfer', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': internalTransferKey,
          },
          body: JSON.stringify({
            recipientInput: targetAddress,
            asset,
            amount: withdrawAmt,
            totpCode: values.totpCode?.trim() || '',
            idempotencyKey: internalTransferKey,
          }),
        });

        const transferData = await transferRes.json();
        if (!transferRes.ok || transferData.error) {
          throw new Error(transferData.error || 'Failed to complete internal transfer');
        }

        if (transferData.idempotentReplay || transferData.idempotent_replay) {
          toast({
            title: 'Internal Transfer Already Completed',
            description: `This transfer was previously completed (ID: ${transferData.transferId}).`,
          });
        } else {
          toast({
            title: 'Internal Transfer Completed!',
            description: `Address belongs to @${transferData.recipientUsername}. Processed instantly as an internal transfer (1.5% Fee: ${transferData.fee} ${asset}).`,
          });
        }

        await refreshBalances();
        onOpenChange(false);
        return;
      }

      // Standard On-chain withdrawal
      const totalRequired = withdrawAmt + Number(feeInCrypto || 0);
      if (totalRequired > availableBalance) {
        form.setError("amount", {
          message: `Insufficient balance to cover withdrawal (${withdrawAmt} ${asset}) + network gas fee (${feeInCrypto.toFixed(6)} ${asset}).`,
        });
        return;
      }

      await requestWithdrawal(
        asset,
        values.chain,
        targetAddress,
        withdrawAmt,
        feeInCrypto,
        values.totpCode?.trim()
      );

      toast({
        title: "Withdrawal Requested",
        description: `Your withdrawal of ${withdrawAmt} ${asset} has been submitted for processing.`,
      });
      await refreshBalances();
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to process withdrawal.";
      if (
        message.toLowerCase().includes('totp') ||
        message.toLowerCase().includes('2fa') ||
        message.toLowerCase().includes('authenticator') ||
        message.toLowerCase().includes('two_factor')
      ) {
        setIs2faEnabledState(true);
      }
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Withdraw {asset}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-2">
            <FormField
              control={form.control}
              name="chain"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Network</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value || ''}>
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
                  <FormLabel>Destination Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={`Enter ${watchedChain || asset || ''} address`}
                      {...field}
                      value={field.value || ''}
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
                        value={field.value === undefined ? '' : field.value}
                        onChange={(e) => field.onChange(e.target.value)}
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
                    <span>Available: {Number(availableBalance || 0) === 0 ? '0' : Number(availableBalance || 0).toFixed(8)} {asset}</span>
                    {prices[asset || ''] ? (
                      <span>≈ ${(Number(availableBalance || 0) * (prices[asset || ''] || 0)).toFixed(2)} USD</span>
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
                      <span>{feeInCrypto > 0 ? Number(feeInCrypto).toFixed(6) : '0.00'} {asset}</span>
                      {feeInUsd > 0 && (
                        <span className="text-[10px] text-muted-foreground">(${Number(feeInUsd).toFixed(2)})</span>
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
                  <span>{(Number(gasFeeData.base_fee_gwei) + Number(gasFeeData.priority_fee_gwei || 0)).toFixed(1)} Gwei</span>
                </div>
              )}

              <div className="border-t border-border/40 pt-2 flex justify-between items-center font-medium">
                <span>Total Balance Deducted:</span>
                <span className="font-mono text-foreground font-semibold">
                  {totalDeducted > 0 ? Number(totalDeducted).toFixed(6) : '0.00'} {asset}
                </span>
              </div>

              <div className="flex justify-between items-center text-muted-foreground">
                <span>You Will Receive:</span>
                <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {Math.max(0, numericWatchedAmount).toFixed(6)} {asset}
                </span>
              </div>
            </div>

            {isInsufficientBalance && (
              <div className="flex items-start gap-2 p-2.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-md text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Insufficient balance. Total deduction ({Number(totalDeducted).toFixed(6)} {asset}) exceeds available balance ({Number(availableBalance).toFixed(6)} {asset}).
                </span>
              </div>
            )}

            {is2faActive && (
              <FormField
                control={form.control}
                name="totpCode"
                render={({ field }) => (
                  <FormItem className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                    <FormLabel className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      <ShieldCheck className="h-4 w-4" />
                      Two-Factor Authentication (2FA)
                    </FormLabel>
                    <FormControl>
                      <Input
                        id="withdraw-totp-input"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={8}
                        placeholder="Enter 4-8 digit authenticator code"
                        className="font-mono text-center tracking-widest bg-background"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage className="text-[11px]" />
                  </FormItem>
                )}
              />
            )}

            <Button
              id="confirm-withdrawal-button"
              type="submit"
              disabled={
                isLoading ||
                isInsufficientBalance ||
                !numericWatchedAmount ||
                numericWatchedAmount <= 0 ||
                !watchedChain ||
                (is2faActive && (!form.watch('totpCode') || form.watch('totpCode')!.trim().length < 4))
              }
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

export default WithdrawDialog;
