'use client';

import React from 'react';
import { ShieldCheck, Sparkles, Gem, Crown } from 'lucide-react';
import { MERCHANT_TIERS, type MerchantTier } from '@/lib/merchant';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MerchantBadgeProps {
  tier?: string | MerchantTier | null;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function MerchantBadge({
  tier,
  showLabel = true,
  size = 'md',
  className,
}: MerchantBadgeProps) {
  const normTier = (tier || '').toUpperCase() as MerchantTier;
  if (!normTier || normTier === 'NONE' || !MERCHANT_TIERS[normTier]) {
    return null;
  }

  const config = MERCHANT_TIERS[normTier];

  const getIcon = () => {
    switch (normTier) {
      case 'GOLD':
        return <Crown className={cn(size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5', 'text-amber-500 fill-amber-500/20')} />;
      case 'DIAMOND':
        return <Gem className={cn(size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5', 'text-cyan-500 fill-cyan-500/20')} />;
      case 'ELITE':
        return <ShieldCheck className={cn(size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-4.5 w-4.5' : 'h-4 w-4', 'text-purple-500 fill-purple-500/20')} />;
      default:
        return <Sparkles className="h-3 w-3 text-amber-500" />;
    }
  };

  const badgeContent = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-bold tracking-tight rounded-full border transition-all select-none',
        config.badgeBg,
        config.borderColor,
        config.badgeColor,
        size === 'sm' && 'px-1.5 py-0.5 text-[10px]',
        size === 'md' && 'px-2.5 py-0.5 text-xs',
        size === 'lg' && 'px-3 py-1 text-xs',
        className
      )}
    >
      {getIcon()}
      {showLabel && <span>{config.label}</span>}
    </span>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badgeContent}</TooltipTrigger>
        <TooltipContent className="bg-slate-900 border border-slate-800 text-white p-3 text-xs max-w-xs shadow-xl rounded-xl">
          <div className="space-y-1.5">
            <p className="font-bold flex items-center gap-1.5 text-slate-100">
              {getIcon()} {config.label}
            </p>
            <p className="text-[11px] text-slate-400">
              Verified Security Deposit: ${config.requiredDepositUsdt.toLocaleString()} USDT locked in Paxones Escrow Reserve.
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
