import { SupabaseClient } from '@supabase/supabase-js';

export const TIER_1_CUMULATIVE_BUY_LIMIT_USD = 1000.0;

export interface KycTierInfo {
  tier: 1 | 2;
  isTier2: boolean;
  tierLabel: string;
  cumulativeBuyVolumeUsd: number;
  remainingBuyAllowanceUsd: number | null; // null represents unlimited (Tier 2)
  canBuy: boolean;
  canSell: boolean;
  canTransferOut: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  canReceiveTransfer: boolean;
}

/**
 * Evaluates whether a user profile has achieved approved/verified Tier 2 KYC status.
 * Strictly checks that status is approved/verified (not pending, in_review, or rejected).
 */
export function isTier2User(profile: any): boolean {
  if (!profile) return false;

  const rawStatus = String(
    profile?.kyc_status || ''
  ).toLowerCase().trim();

  return rawStatus === 'approved' || rawStatus === 'verified';
}

/**
 * Returns the numeric KYC tier (1 or 2).
 */
export function getUserKycTier(profile: any): 1 | 2 {
  return isTier2User(profile) ? 2 : 1;
}

/**
 * Calculates a user's cumulative BUY volume in USD across all non-cancelled, non-expired trades.
 * Does NOT count SELL, transfers, deposits, or withdrawals.
 */
export async function calculateUserCumulativeBuyVolume(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  if (!userId) return 0;

  try {
    const { data: buyTrades, error } = await supabase
      .from('trades')
      .select('fiat_amount, crypto_amount, price, unit_price, status')
      .eq('buyer_id', userId);

    if (error || !buyTrades) {
      console.warn('[KYC] Error querying user buy trades:', error);
      return 0;
    }

    const NON_QUALIFYING_STATUSES = new Set(['cancelled', 'canceled', 'expired', 'failed', 'rejected']);

    let totalUsd = 0;
    for (const trade of buyTrades) {
      const status = String(trade.status || '').toLowerCase().trim();
      if (!NON_QUALIFYING_STATUSES.has(status)) {
        const fiatAmt = Number(trade.fiat_amount);
        if (!isNaN(fiatAmt) && fiatAmt > 0) {
          totalUsd += fiatAmt;
        } else {
          const cryptoAmt = Number(trade.crypto_amount) || 0;
          const unitPrice = Number(trade.price ?? trade.unit_price ?? 1.0) || 1.0;
          totalUsd += cryptoAmt * unitPrice;
        }
      }
    }

    return Number(totalUsd.toFixed(2));
  } catch (err) {
    console.error('[KYC] Exception calculating cumulative buy volume:', err);
    return 0;
  }
}

/**
 * Fetches comprehensive KYC tier information and real-time remaining BUY allowance for a user.
 */
export async function getUserKycTierInfo(
  supabase: SupabaseClient,
  userId: string
): Promise<KycTierInfo> {
  let profile: any = null;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, kyc_status, is_verified, id_verified, is_id_verified, verification_tier')
      .eq('id', userId)
      .maybeSingle();
    profile = data;
  } catch (err) {
    console.warn('[KYC] Error fetching user profile for tier info:', err);
  }

  const isTier2 = isTier2User(profile);
  const tier: 1 | 2 = isTier2 ? 2 : 1;

  if (isTier2) {
    return {
      tier: 2,
      isTier2: true,
      tierLabel: 'Tier 2 (Verified — Unlimited)',
      cumulativeBuyVolumeUsd: 0,
      remainingBuyAllowanceUsd: null,
      canBuy: true,
      canSell: true,
      canTransferOut: true,
      canWithdraw: true,
      canDeposit: true,
      canReceiveTransfer: true,
    };
  }

  const cumulativeBuyVolumeUsd = await calculateUserCumulativeBuyVolume(supabase, userId);
  const remainingBuyAllowanceUsd = Math.max(0, Number((TIER_1_CUMULATIVE_BUY_LIMIT_USD - cumulativeBuyVolumeUsd).toFixed(2)));

  return {
    tier: 1,
    isTier2: false,
    tierLabel: `Tier 1 ($${remainingBuyAllowanceUsd.toLocaleString()} remaining of $1,000 USD Limit)`,
    cumulativeBuyVolumeUsd,
    remainingBuyAllowanceUsd,
    canBuy: remainingBuyAllowanceUsd > 0,
    canSell: false,
    canTransferOut: false,
    canWithdraw: false,
    canDeposit: true,
    canReceiveTransfer: true,
  };
}
