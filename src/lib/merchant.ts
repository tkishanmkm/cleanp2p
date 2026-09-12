export type MerchantTier = 'NONE' | 'GOLD' | 'DIAMOND' | 'ELITE';

export interface MerchantTierConfig {
  tier: MerchantTier;
  label: string;
  requiredVolumeUsd: number;
  requiredDepositUsdt: number;
  badgeColor: string;
  badgeBg: string;
  borderColor: string;
  perks: string[];
}

export const MERCHANT_TIERS: Record<MerchantTier, MerchantTierConfig> = {
  NONE: {
    tier: 'NONE',
    label: 'Standard Trader',
    requiredVolumeUsd: 0,
    requiredDepositUsdt: 0,
    badgeColor: 'text-slate-400',
    badgeBg: 'bg-slate-500/10',
    borderColor: 'border-slate-500/20',
    perks: ['Standard Escrow Protection', 'Community Support'],
  },
  GOLD: {
    tier: 'GOLD',
    label: 'Gold Merchant',
    requiredVolumeUsd: 10000,
    requiredDepositUsdt: 1000,
    badgeColor: 'text-amber-500 dark:text-amber-400',
    badgeBg: 'bg-amber-500/10 dark:bg-amber-500/20',
    borderColor: 'border-amber-500/30',
    perks: [
      '$1,000 USDT Security Deposit Bond',
      'Gold Verified Merchant Badge',
      'Priority Ad Ranking on Marketplace',
      'Fast-Track Dispute Resolution Support',
    ],
  },
  DIAMOND: {
    tier: 'DIAMOND',
    label: 'Diamond Merchant',
    requiredVolumeUsd: 100000,
    requiredDepositUsdt: 10000,
    badgeColor: 'text-cyan-600 dark:text-cyan-400',
    badgeBg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
    borderColor: 'border-cyan-500/30',
    perks: [
      '$10,000 USDT Security Deposit Bond',
      'Diamond Verified Merchant Badge',
      'Top Marketplace Placement & Verified Trust Seal',
      'Dedicated Account Liaison & Priority Support',
      'Zero Maker Listing Surcharges',
    ],
  },
  ELITE: {
    tier: 'ELITE',
    label: 'Elite Merchant',
    requiredVolumeUsd: 1000000,
    requiredDepositUsdt: 50000,
    badgeColor: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-500/10 dark:bg-purple-500/20',
    borderColor: 'border-purple-500/30',
    perks: [
      '$50,000 USDT Institutional Security Deposit Bond',
      'Elite High-Volume Merchant Badge',
      'Institutional VIP Order Flow & Unlimited Limits',
      '24/7 Direct Arbitration Manager',
      'Exclusive OTC Private Trade Desk Access',
    ],
  },
};

/**
 * Calculate incremental deposit needed when upgrading from current tier to target tier.
 */
export function calculateUpgradeDeposit(
  currentTier: MerchantTier = 'NONE',
  targetTier: MerchantTier,
  currentLockedDeposit: number = 0
): { requiredDeposit: number; incrementalDeposit: number; meetsVolume: boolean } {
  const targetConfig = MERCHANT_TIERS[targetTier] || MERCHANT_TIERS.NONE;
  const currentConfig = MERCHANT_TIERS[currentTier] || MERCHANT_TIERS.NONE;

  const totalRequired = targetConfig.requiredDepositUsdt;
  const effectiveLocked = Math.max(currentLockedDeposit, currentConfig.requiredDepositUsdt);
  const incremental = Math.max(0, totalRequired - effectiveLocked);

  return {
    requiredDeposit: totalRequired,
    incrementalDeposit: incremental,
    meetsVolume: false, // Calculated against profile volume
  };
}
