"use client";

import { useEffect, useState } from "react";

export interface PublicPlatformFeeSettings {
  platformFeePercent: number;
  escrowFeePercent: number;
  minTradeAmount: number;
}

export function usePlatformFeeSettings(): {
  fees: PublicPlatformFeeSettings | null;
  isLoading: boolean;
  error: string | null;
} {
  const [fees, setFees] = useState<PublicPlatformFeeSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/platform/fees", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload?.success !== true || !payload?.fees) {
          throw new Error(payload?.error || "Platform fee settings are unavailable.");
        }
        const next: PublicPlatformFeeSettings = {
          platformFeePercent: Number(payload.fees.platformFeePercent),
          escrowFeePercent: Number(payload.fees.escrowFeePercent),
          minTradeAmount: Number(payload.fees.minTradeAmount),
        };
        if (
          !Number.isFinite(next.platformFeePercent) || next.platformFeePercent < 0 || next.platformFeePercent > 10 ||
          !Number.isFinite(next.escrowFeePercent) || next.escrowFeePercent < 0 || next.escrowFeePercent > 10 ||
          !Number.isFinite(next.minTradeAmount) || next.minTradeAmount <= 0
        ) {
          throw new Error("Platform fee settings are invalid.");
        }
        if (active) setFees(next);
      } catch (loadError) {
        if (active) {
          setFees(null);
          setError(loadError instanceof Error ? loadError.message : "Platform fee settings are unavailable.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  return { fees, isLoading, error };
}
