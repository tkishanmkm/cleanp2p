'use client';

import React from 'react';

export interface AdCardProps {
  minLimit: number; // e.g., 100
  maxLimit: number; // e.g., 1000
  advertiserBalanceUSD: number; // e.g., 1100 or 900
  customUnitPrice: number; // Advertiser custom unit price
  fiatCurrency?: string;
  cryptoSymbol?: string;
}

export function AdCard({
  minLimit,
  maxLimit,
  advertiserBalanceUSD,
  customUnitPrice,
  fiatCurrency = 'USD',
  cryptoSymbol = 'USDT',
}: AdCardProps) {
  // Dynamic Limit Logic
  // Case 1: Min = 100, Max = 1000, Balance = $1100 -> Display Limit: 100–1000 USD.
  // Case 2: Min = 100, Max = 1000, Balance = $900 -> Display Limit: 100–900 USD.
  const effectiveMaxLimit = Math.min(maxLimit, advertiserBalanceUSD);
  const isAvailable = advertiserBalanceUSD >= minLimit;

  return (
    <div className="bg-card text-card-foreground p-4 sm:p-5 rounded-xl border border-border shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-all hover:shadow-md">
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground uppercase font-semibold">Unit Price</div>
        <div className="text-lg font-extrabold text-foreground font-mono">
          {customUnitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
          <span className="text-xs font-normal text-muted-foreground">{fiatCurrency}</span>
        </div>
      </div>

      <div className="space-y-1 md:text-right">
        <div className="text-xs text-muted-foreground block font-medium">Available Order Limit</div>
        {isAvailable ? (
          <div className="text-sm font-semibold text-foreground">
            {minLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} – {effectiveMaxLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            <span className="text-xs font-normal text-muted-foreground">{fiatCurrency}</span>
          </div>
        ) : (
          <div className="text-xs font-semibold text-destructive">
            Insufficient Advertiser Balance
          </div>
        )}
      </div>
    </div>
  );
}

export default AdCard;
