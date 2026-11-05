"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/input";
import { UserStatusIndicator } from "@/components/user-status";
import { Loader2, ArrowRightLeft, ShieldCheck } from "lucide-react";
import { calculateMinimumFiatAmount } from "@/lib/currency";
import { usePlatformFeeSettings } from "@/hooks/use-platform-fees";
import { playTradeBeep } from "@/lib/utils";
import { useI18n } from "@/context/i18n-context";

export interface AdData {
  id: string;
  user_id: string;
  type: "BUY" | "SELL";
  asset_symbol: string;
  fiat_symbol: string;
  price: number;
  min_limit: number;
  max_limit: number;
  payment_methods?: string[];
  profiles?:
    | {
        username?: string;
        full_name?: string;
        last_active?: string;
      }
    | Array<{
        username?: string;
        full_name?: string;
        last_active?: string;
      }>;
}

export interface TradeInitiationModalProps {
  ad: AdData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function TradeInitiationModal({ ad, isOpen, onClose }: TradeInitiationModalProps) {
  const router = useRouter();
  const { t, language } = useI18n();
  const [fiatAmount, setFiatAmount] = useState<string>("");
  const [cryptoAmount, setCryptoAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { fees: platformFees, isLoading: isFeeSettingsLoading, error: feeSettingsError } = usePlatformFeeSettings();

  const availablePaymentMethods = Array.isArray(ad?.payment_methods)
    ? ad.payment_methods.filter((method): method is string => typeof method === "string" && method.trim().length > 0)
    : typeof (ad as any)?.payment_method === "string" && (ad as any).payment_method.trim().length > 0
      ? [(ad as any).payment_method.trim()]
      : [];

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(
    availablePaymentMethods.length === 1 ? availablePaymentMethods[0] : ""
  );

  // Reset form state when a different ad is opened. Wallet eligibility is enforced
  // atomically by the canonical wallet_assets escrow RPC, not a legacy balances table.
  useEffect(() => {
    if (isOpen && ad) {
      setFiatAmount("");
      setCryptoAmount("");
      setErrorMsg(null);
      const methods = Array.isArray(ad.payment_methods) && ad.payment_methods.length > 0
        ? ad.payment_methods
        : typeof (ad as any)?.payment_method === "string" && (ad as any).payment_method.trim().length > 0
          ? [(ad as any).payment_method.trim()]
          : [];
      setSelectedPaymentMethod(methods.length === 1 ? methods[0] : "");
    }
  }, [isOpen, ad?.id]);

  if (!ad) return null;

  const traderProfile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles;
  const isBuyModal = ad.type === "SELL"; // User is BUYING from a SELL ad

  // Recalculate Crypto when Fiat changes
  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    setErrorMsg(null);
    const numVal = parseFloat(val);
    if (!isNaN(numVal) && ad.price > 0) {
      setCryptoAmount((numVal / ad.price).toFixed(6));
    } else {
      setCryptoAmount("");
    }
  };

  // Recalculate Fiat when Crypto changes
  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    setErrorMsg(null);
    const numVal = parseFloat(val);
    if (!isNaN(numVal) && ad.price > 0) {
      setFiatAmount((numVal * ad.price).toFixed(2));
    } else {
      setFiatAmount("");
    }
  };

  const handleStartTrade = async () => {
    const numericFiat = Number(fiatAmount);
    const numericCrypto = Number(cryptoAmount);

    if (!Number.isFinite(numericFiat) || numericFiat <= 0) {
      setErrorMsg(t('tradeInitiation.validFiatAmount'));
      return;
    }
    if (!Number.isFinite(numericCrypto) || numericCrypto <= 0) {
      setErrorMsg(t('tradeInitiation.validCryptoAmount'));
      return;
    }

    if (isFeeSettingsLoading || !platformFees) {
      setErrorMsg(feeSettingsError || t('tradeInitiation.feeSettingsUnavailable'));
      return;
    }
    if (!Number.isFinite(ad.price) || ad.price <= 0) {
      setErrorMsg(t('tradeInitiation.invalidPrice'));
      return;
    }

    const minLimit = Number(ad.min_limit);
    const maxLimit = Number(ad.max_limit);
    if (!Number.isFinite(minLimit) || minLimit <= 0 || !Number.isFinite(maxLimit) || maxLimit < minLimit) {
      setErrorMsg(t('tradeInitiation.invalidOrderLimits'));
      return;
    }
    const dynamicMin = calculateMinimumFiatAmount(platformFees.minTradeAmount, ad.fiat_symbol);
    const effectiveMin = Math.max(minLimit, dynamicMin);

    if (numericFiat < effectiveMin || numericFiat > maxLimit) {
      setErrorMsg(t('tradeInitiation.amountRange').replace('{min}', effectiveMin.toLocaleString(language)).replace('{max}', maxLimit.toLocaleString(language)).replace('{currency}', ad.fiat_symbol).replace('{usdMin}', platformFees.minTradeAmount.toLocaleString(language)));
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setErrorMsg(t('tradeInitiation.signInRequired'));
        setLoading(false);
        return;
      }

      if (user.id === ad.user_id) {
        setErrorMsg(t('tradeInitiation.cannotTradeOwnAd'));
        setLoading(false);
        return;
      }

      if (availablePaymentMethods.length === 0) {
        setErrorMsg(t('tradeInitiation.noPaymentMethods'));
        setLoading(false);
        return;
      }
      if (availablePaymentMethods.length > 1 && !selectedPaymentMethod) {
        setErrorMsg(t('tradeInitiation.selectPaymentMethodError'));
        setLoading(false);
        return;
      }

      const paymentMethod = selectedPaymentMethod || availablePaymentMethods[0];

      // Trade creation must go through the authenticated, atomic escrow RPC.
      // Never fall back to a direct client-side trades insert: that can bypass escrow.
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch('/api/trades/initiate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          adId: ad.id,
          cryptoAmount: numericCrypto,
          fiatAmount: numericFiat,
          paymentMethod,
          idempotencyKey,
        }),
      });

      const resData = await response.json().catch(() => null);
      if (!response.ok) {
        const errorCode = resData?.code;
        if (errorCode === 'AD_OWNER_OFFLINE') {
          throw new Error(t('tradeChat.adOwnerOffline').replace('{attempts}', String(resData?.attempts ?? 1)));
        }
        if (errorCode === 'AD_AUTO_PAUSED_OFFLINE') {
          throw new Error(t('tradeChat.adAutoPausedOffline'));
        }
        if (errorCode === 'AD_AVAILABILITY_CHECK_FAILED') {
          throw new Error(t('tradeChat.availabilityCheckFailed'));
        }
        if (errorCode === 'AD_NOT_ACTIVE') {
          throw new Error(t('tradeChat.adNotActive'));
        }
        if (errorCode === 'AD_NOT_FOUND') {
          throw new Error(t('tradeChat.adNotFound'));
        }
        throw new Error(resData?.error || t('tradeInitiation.secureInitiationFailed'));
      }

      const tradeId = resData?.tradeId || resData?.trade?.id || resData?.id;
      if (!tradeId) {
        throw new Error(t('tradeInitiation.missingTradeId'));
      }

      // Sound feedback and redirect to trade execution page
      try {
        playTradeBeep();
      } catch {}
      onClose();
      router.push(`/trade/${tradeId}`);
    } catch (err: any) {
      console.error("Trade creation failed:", err);
      setErrorMsg(err.message || t('tradeInitiation.initiationFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[480px] p-6 rounded-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between pb-2">
            <DialogTitle className="text-xl font-bold">
              {isBuyModal ? t('tradeInitiation.buy') : t('tradeInitiation.sell')} {ad.asset_symbol}
            </DialogTitle>
            <span className="text-xs font-mono text-muted-foreground">{t('tradeInitiation.adId')} {ad.id}</span>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t('tradeInitiation.priceLocked')}
          </DialogDescription>
        </DialogHeader>

        {/* Trader Info Row */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border my-2">
          <div className="space-y-0.5">
            <p className="font-semibold text-sm">
              @{traderProfile?.username || t('counterpartyPanel.fallbackTrader')}
            </p>
          </div>
          <UserStatusIndicator user={traderProfile} />
        </div>

        {/* Pricing & Limits */}
        <div className="grid grid-cols-2 gap-3 text-sm py-2">
          <div>
            <span className="text-xs text-muted-foreground">{t('tradeInitiation.unitPrice')}</span>
            <p className="font-bold text-foreground">
              {Number(ad.price).toLocaleString(language)} {ad.fiat_symbol} / {ad.asset_symbol}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">{t('tradeInitiation.orderLimits')}</span>
            <p className="font-semibold text-foreground">
              {Number(ad.min_limit).toLocaleString(language)} - {Number(ad.max_limit).toLocaleString(language)} {ad.fiat_symbol}
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4 my-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              {(isBuyModal ? t('tradeInitiation.amountToPayFiat') : t('tradeInitiation.amountToReceiveFiat')).replace('{fiat}', ad.fiat_symbol)}
            </label>
            <div className="relative">
              <Input
                type="number"
                placeholder={`${Number(ad.min_limit).toLocaleString(language)} - ${Number(ad.max_limit).toLocaleString(language)}`}
                value={fiatAmount}
                onChange={(e) => handleFiatChange(e.target.value)}
                className="pr-12 font-semibold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                {ad.fiat_symbol}
              </span>
            </div>
          </div>

          <div className="flex justify-center">
            <ArrowRightLeft className="w-4 h-4 text-muted-foreground rotate-90" />
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs font-medium text-muted-foreground">
                {(isBuyModal ? t('tradeInitiation.amountToReceiveCrypto') : t('tradeInitiation.amountToPayCrypto')).replace('{asset}', ad.asset_symbol)}
              </label>
              <button
                type="button"
                onClick={() => {
                  const maxAllowableFromAd = ad.price > 0 ? ad.max_limit / ad.price : 0;
                  handleCryptoChange(Math.max(0, maxAllowableFromAd).toFixed(8));
                }}
                className="text-[10px] font-semibold text-[#5D45F9] hover:underline"
              >
                {t('tradeInitiation.max')}
              </button>
            </div>
            <div className="relative">
              <Input
                type="number"
                placeholder="0.000000"
                value={cryptoAmount}
                onChange={(e) => handleCryptoChange(e.target.value)}
                className="pr-16 font-semibold"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                {ad.asset_symbol}
              </span>
            </div>
          </div>
        </div>

        {/* Payment Method Selection */}
        {availablePaymentMethods.length > 1 ? (
          <div className="space-y-1.5 my-2">
            <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
              <span>{t('tradeInitiation.selectPaymentMethod')}</span>
              <span className="text-rose-500 font-bold">* {t('tradeInitiation.required')}</span>
            </label>
            <select
              value={selectedPaymentMethod}
              onChange={(e) => {
                setSelectedPaymentMethod(e.target.value);
                setErrorMsg(null);
              }}
              className="w-full h-10 px-3 rounded-xl border bg-background text-xs font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#5D45F9]/30"
            >
              <option value="" disabled>{t('tradeInitiation.choosePaymentMethod')}</option>
              {availablePaymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex justify-between items-center px-3 py-2 rounded-xl bg-muted/40 border text-xs my-2">
            <span className="text-muted-foreground font-medium">{t('tradeInitiation.paymentMethod')}</span>
            <span className="font-semibold text-foreground">
              {availablePaymentMethods[0] || t('tradeInitiation.notConfigured')}
            </span>
          </div>
        )}

        {/* Escrow Fee & Breakdown */}
        {cryptoAmount && parseFloat(cryptoAmount) > 0 && (
          <div className="p-3 rounded-xl bg-muted/30 border text-xs space-y-1.5 my-2 font-mono">
            <div className="flex justify-between text-muted-foreground">
              <span>{t('tradeInitiation.tradeAmount')}</span>
              <span>{parseFloat(cryptoAmount || '0').toFixed(4)} {ad.asset_symbol}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{t('tradeInitiation.escrowFee').replace('{rate}', platformFees ? platformFees.escrowFeePercent.toFixed(2) : '—')}</span>
              <span>{(parseFloat(cryptoAmount || '0') * (platformFees?.escrowFeePercent ?? 0) / 100).toFixed(8)} {ad.asset_symbol}</span>
            </div>
            <div className="flex justify-between font-semibold text-foreground border-t pt-1">
              <span>{t('tradeInitiation.totalLockedWallet')}</span>
              <span>{(parseFloat(cryptoAmount || '0') * (1 + (platformFees?.escrowFeePercent ?? 0) / 100)).toFixed(8)} {ad.asset_symbol}</span>
            </div>
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium pt-0.5">
              <span>{t('tradeInitiation.netReceivedBuyer')}</span>
              <span>{parseFloat(cryptoAmount || '0').toFixed(4)} {ad.asset_symbol}</span>
            </div>
          </div>
        )}

        {/* Error Messaging */}
        {errorMsg && (
          <p className="text-xs text-rose-500 font-medium text-center bg-rose-50 dark:bg-rose-950/30 p-2 rounded-lg border border-rose-200 dark:border-rose-900">
            {errorMsg}
          </p>
        )}

        {/* Footer Actions */}
        <div className="pt-3 space-y-3">
          <Button
            onClick={handleStartTrade}
            disabled={loading || isFeeSettingsLoading || !platformFees || availablePaymentMethods.length === 0 || !fiatAmount}
            className="w-full bg-[#5D45F9] hover:bg-[#4833D8] text-white font-semibold py-2.5 rounded-xl transition-all"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              isBuyModal ? t('tradeInitiation.initiateBuyOrder') : t('tradeInitiation.initiateSellOrder')
            )}
          </Button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>{t('tradeInitiation.escrowSafety')}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TradeInitiationModal;
