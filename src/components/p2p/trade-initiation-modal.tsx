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
  const [fiatAmount, setFiatAmount] = useState<string>("");
  const [cryptoAmount, setCryptoAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset inputs when modal opens with a new ad
  useEffect(() => {
    if (isOpen) {
      setFiatAmount("");
      setCryptoAmount("");
      setErrorMsg(null);
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
    const numericFiat = parseFloat(fiatAmount);

    if (isNaN(numericFiat) || numericFiat <= 0) {
      setErrorMsg("Please enter a valid amount.");
      return;
    }

    if (numericFiat < ad.min_limit || numericFiat > ad.max_limit) {
      setErrorMsg(`Amount must be between ${ad.min_limit} and ${ad.max_limit} ${ad.fiat_symbol}.`);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        setErrorMsg("Please sign in to initiate a trade.");
        setLoading(false);
        return;
      }

      if (user.id === ad.user_id) {
        setErrorMsg("You cannot trade with your own advertisement.");
        setLoading(false);
        return;
      }

      // Determine buyer and seller based on ad type
      const buyerId = isBuyModal ? user.id : ad.user_id;
      const sellerId = isBuyModal ? ad.user_id : user.id;

      const numericCrypto = parseFloat(cryptoAmount) || (ad.price > 0 ? numericFiat / ad.price : 0);
      const paymentMethod = (Array.isArray(ad.payment_methods) && ad.payment_methods.length > 0)
        ? ad.payment_methods[0]
        : "Bank Transfer";

      // Try inserting with comprehensive trade fields
      let { data: trade, error: tradeError } = await supabase
        .from("trades")
        .insert({
          ad_id: ad.id,
          buyer_id: buyerId,
          seller_id: sellerId,
          crypto: ad.asset_symbol,
          amount: numericCrypto,
          fiat_currency: ad.fiat_symbol,
          fiat_amount: numericFiat,
          amount_usd: numericFiat,
          price: ad.price,
          payment_method: paymentMethod,
          status: "pending",
        })
        .select("id")
        .single();

      // Fallback if schema only accepts basic fields
      if (tradeError) {
        console.warn("Retrying trade insertion with minimal schema...", tradeError);
        const { data: fallbackTrade, error: fallbackError } = await supabase
          .from("trades")
          .insert({
            buyer_id: buyerId,
            seller_id: sellerId,
            amount_usd: numericFiat,
            status: "pending",
          })
          .select("id")
          .single();

        if (fallbackError) {
          throw fallbackError;
        }
        trade = fallbackTrade;
      }

      if (!trade || !trade.id) {
        throw new Error("Trade creation returned no ID.");
      }

      // Redirect to trade execution page
      onClose();
      router.push(`/trade/${trade.id}`);
    } catch (err: any) {
      console.error("Trade creation failed:", err);
      setErrorMsg(err.message || "Failed to initiate trade. Please try again.");
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
              {isBuyModal ? "Buy" : "Sell"} {ad.asset_symbol}
            </DialogTitle>
            <span className="text-xs font-mono text-muted-foreground">Ad ID: {ad.id}</span>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Price is locked once the order is created.
          </DialogDescription>
        </DialogHeader>

        {/* Trader Info Row */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border my-2">
          <div className="space-y-0.5">
            <p className="font-semibold text-sm">
              {traderProfile?.full_name || traderProfile?.username || "Trader"}
            </p>
            <p className="text-xs text-muted-foreground">@{traderProfile?.username || "user"}</p>
          </div>
          <UserStatusIndicator lastActive={traderProfile?.last_active} />
        </div>

        {/* Pricing & Limits */}
        <div className="grid grid-cols-2 gap-3 text-sm py-2">
          <div>
            <span className="text-xs text-muted-foreground">Unit Price</span>
            <p className="font-bold text-foreground">
              {ad.price} {ad.fiat_symbol}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Order Limits</span>
            <p className="font-semibold text-foreground">
              {ad.min_limit} - {ad.max_limit} {ad.fiat_symbol}
            </p>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4 my-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              I want to {isBuyModal ? "pay" : "receive"} ({ad.fiat_symbol})
            </label>
            <div className="relative">
              <Input
                type="number"
                placeholder={`${ad.min_limit} - ${ad.max_limit}`}
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
            <label className="text-xs font-medium text-muted-foreground">
              I will {isBuyModal ? "receive" : "pay"} ({ad.asset_symbol})
            </label>
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
            disabled={loading || !fiatAmount}
            className="w-full bg-[#5D45F9] hover:bg-[#4833D8] text-white font-semibold py-2.5 rounded-xl transition-all"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              `Initiate ${isBuyModal ? "Buy" : "Sell"} Order`
            )}
          </Button>

          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Escrow protected. Crypto is locked safely during the trade.</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default TradeInitiationModal;
