import { isTier2User } from '@/lib/kyc';

export interface TradeEligibilityFailure {
  status: number;
  code: string;
  error: string;
}

function fiatToUsdRate(currency: string): number {
  switch (currency.toUpperCase()) {
    case 'INR': return 1 / 85;
    case 'EUR': return 1.08;
    case 'GBP': return 1.28;
    case 'CAD':
    case 'AUD': return 0.68;
    case 'AED': return 0.27;
    default: return 1;
  }
}

/**
 * Shared route-level P2P eligibility checks. The database RPC still enforces
 * atomic escrow locking, emergency controls, and authoritative pricing.
 */
export async function getTradeEligibilityFailure(
  supabase: any,
  user: any,
  ad: any,
  fiatAmount: number,
  fiatCurrency: string
): Promise<TradeEligibilityFailure | null> {
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return { status: 400, code: 'INVALID_FIAT_AMOUNT', error: 'Trade fiat amount must be a finite positive number.' };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return { status: 503, code: 'PROFILE_LOOKUP_FAILED', error: 'Unable to verify trade eligibility. Please try again.' };
  }

  const hasFullName = Boolean(
    profile?.full_name?.trim() ||
    profile?.display_name?.trim() ||
    user.user_metadata?.full_name?.trim() ||
    user.user_metadata?.name?.trim()
  );
  const kycVerified = isTier2User(profile);

  if (ad.require_full_name_verified && !hasFullName) {
    return { status: 403, code: 'FULL_NAME_VERIFICATION_REQUIRED', error: 'This advertisement requires a verified full legal name.' };
  }
  if (ad.require_verified_users && !kycVerified) {
    return { status: 403, code: 'KYC_REQUIRED', error: 'This advertisement requires completed identity verification.' };
  }

  if (!kycVerified) {
    const { data: pastTrades, error: historyError } = await supabase
      .from('trades')
      .select('fiat_amount, fiat_currency, status')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .in('status', ['COMPLETED', 'completed', 'PAID', 'paid', 'ESCROW_LOCKED', 'in_escrow', 'DISPUTED']);

    if (historyError) {
      return { status: 503, code: 'TRADE_HISTORY_UNAVAILABLE', error: 'Unable to verify your cumulative trade limit. Please try again.' };
    }

    const priorUsd = (pastTrades || []).reduce((sum: number, trade: any) => {
      const amount = Number(trade.fiat_amount);
      if (!Number.isFinite(amount) || amount <= 0) return sum;
      return sum + amount * fiatToUsdRate(String(trade.fiat_currency || 'USD'));
    }, 0);
    const currentUsd = fiatAmount * fiatToUsdRate(fiatCurrency || ad.fiat_currency || ad.fiat || 'USD');

    if (priorUsd + currentUsd > 1000) {
      return {
        status: 403,
        code: 'UNVERIFIED_TRADE_LIMIT',
        error: `Unverified accounts have a cumulative limit of $1,000 USD in total trades (current history: $${priorUsd.toFixed(2)} USD). Please complete identity verification to trade without limits.`,
      };
    }
  }

  return null;
}
