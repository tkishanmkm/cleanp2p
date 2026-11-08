'use server';

import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { getPlatformFeeSettings } from '@/lib/platform-fees';
import { generateTradeId } from '@/lib/id-generator';
import { findAdById } from '@/lib/ad-lookup';
import { sendNewTradeNotificationEmail } from '@/lib/email/tradeEmailService';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { assertPlatformControlAllowed } from '@/lib/platform-guard';
import { isTier2User } from '@/lib/kyc';

export interface ActionResponse<T> {
  data: T | null;
  error: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null;
}

function isValidUUID(str: any): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str.trim());
}

/**
 * Robust helper to fetch user wallet balance across all possible storage locations:
 * 1. wallets -> wallet_assets (foreign key schema)
 * 2. wallet_assets by user_id
 * 3. user_wallets table/view
 * 4. profiles table (btc_balance, eth_balance, ltc_balance, usdt_balance, wallets JSON)
 */

export async function getMarketplaceAds(tradeType: 'BUY' | 'SELL' | 'buy' | 'sell'): Promise<ActionResponse<any[]>> {
  try {
    const supabase = await createClient();
    const queryTradeType = tradeType.toUpperCase();

    // Public seller details come from the narrow public_profiles projection,
    // not a relationship join to the private profiles table.
    const { data: ads, error } = await supabase
      .from('ads')
      .select('*')
      .or(`trade_type.eq.${queryTradeType},type.eq.${queryTradeType.toLowerCase()}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Marketplace Supabase Query Error]:', error);
      return {
        data: null,
        error: {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
        },
      };
    }

    const sellerIds = Array.from(new Set(
      (ads || []).map((ad: any) => ad.user_id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    ));
    const { data: publicProfiles, error: publicProfilesError } = sellerIds.length > 0
      ? await supabase
          .from('public_profiles')
          .select('id, username, avatar_url, photo_url, is_online, created_at, merchant_tier, completed_trades, positive_feedback, negative_feedback')
          .in('id', sellerIds)
      : { data: [], error: null };

    if (publicProfilesError) {
      console.error('[Marketplace Public Profile Query Error]:', publicProfilesError);
      return {
        data: null,
        error: {
          message: 'Trader profile information is temporarily unavailable.',
          code: publicProfilesError.code,
        },
      };
    }

    const profileMap = new Map((publicProfiles || []).map((profile: any) => [profile.id, profile]));
    const formattedAds = (ads || []).map((ad: any) => {
      const profileRecord = profileMap.get(ad.user_id) || null;
      return {
        ...ad,
        profiles: profileRecord,
        user: profileRecord,
      };
    });

    return { data: formattedAds, error: null };
  } catch (err: any) {
    console.error('[Marketplace Server Action Exception]:', err);
    return {
      data: null,
      error: {
        message: err?.message || 'An unexpected server error occurred while retrieving marketplace offers.',
      },
    };
  }
}

export async function getAdDetails(adId: string): Promise<ActionResponse<any>> {
  try {
    const adminClient = getSupabaseAdminClient();
    const supabase = await createClient();
    const isUUID = isValidUUID(adId);
    let ad: any = null;

    // 1. Try fetching from p2p_ads with admin client (bypasses RLS)
    try {
      let p2pQuery = adminClient.from('p2p_ads').select('*');
      if (isUUID) {
        p2pQuery = p2pQuery.or(`id.eq.${adId},public_ad_id.eq.${adId},public_id.eq.${adId}`);
      } else {
        p2pQuery = p2pQuery.or(`public_ad_id.eq.${adId},public_id.eq.${adId}`);
      }
      const { data: p2pData, error: p2pError } = await p2pQuery.maybeSingle();
      if (!p2pError && p2pData) {
        ad = p2pData;
      }
    } catch (err) {
      console.warn('[getAdDetails] p2p_ads admin query notice:', err);
    }

    // 2. Try fetching from ads table with admin client
    if (!ad) {
      try {
        let adsQuery = adminClient.from('ads').select('*');
        if (isUUID) {
          adsQuery = adsQuery.eq('id', adId);
        } else {
          adsQuery = adsQuery.or(`public_id.eq.${adId},public_ad_id.eq.${adId}`);
        }
        const { data: adsData, error: adsError } = await adsQuery.maybeSingle();
        if (!adsError && adsData) {
          ad = adsData;
        }
      } catch (err) {
        console.warn('[getAdDetails] ads admin query notice:', err);
      }
    }

    // 3. Try with user-scoped supabase client if still not found
    if (!ad) {
      try {
        let userP2PQuery = supabase.from('p2p_ads').select('*');
        if (isUUID) {
          userP2PQuery = userP2PQuery.or(`id.eq.${adId},public_ad_id.eq.${adId},public_id.eq.${adId}`);
        } else {
          userP2PQuery = userP2PQuery.or(`public_ad_id.eq.${adId},public_id.eq.${adId}`);
        }
        const { data: userP2PData } = await userP2PQuery.maybeSingle();
        if (userP2PData) {
          ad = userP2PData;
        }
      } catch (err) {
        console.warn('[getAdDetails] user client p2p query notice:', err);
      }
    }

    // 4. Try fetching seller profile
    let profileData: any = null;
    if (ad && ad.user_id) {
      try {
        const { data: prof } = await adminClient
          .from('public_profiles')
          .select('id, username, display_name, avatar_url, photo_url, country, feedback_score, positive_feedback, negative_feedback, completed_trades, total_completed_trades, avg_release_time_mins, avg_release_minutes, avg_release_time, avg_payment_time_mins, avg_payment_minutes, avg_pay_time, created_at, is_verified, merchant_tier, is_online')
          .eq('id', ad.user_id)
          .maybeSingle();
        if (prof) {
          profileData = prof;
          ad.profiles = prof;
        }
      } catch (err) {
        console.warn('[getAdDetails] profile fetch notice:', err);
      }
    }

    // Never synthesize a marketplace offer when the persisted ad cannot be found.
    // Fake seller identities/prices can send buyers into a trade that cannot be escrowed.
    if (!ad) {
      return {
        data: null,
        error: {
          message: 'Advertisement not found or no longer available.',
          code: 'AD_NOT_FOUND',
        },
      };
    }

    const adStatus = String(ad.status || '').trim().toUpperCase();
    const isPubliclyActive =
      ad.active === true &&
      ad.is_active === true &&
      ad.is_deleted !== true &&
      adStatus === 'ACTIVE';
    if (!isPubliclyActive) {
      const { data: { user } } = await supabase.auth.getUser();
      const isOwner = Boolean(user?.id && user.id === ad.user_id);
      const adminAuth = await verifyServerAdmin();
      if (!isOwner && !adminAuth.authorized) {
        return {
          data: null,
          error: {
            message: 'Advertisement not found or no longer available.',
            code: 'AD_NOT_FOUND',
          },
        };
      }
    }

    if (!ad.user_id || typeof ad.user_id !== 'string') {
      return {
        data: null,
        error: {
          message: 'Advertisement owner could not be verified.',
          code: 'AD_OWNER_UNAVAILABLE',
        },
      };
    }

    const sellerId = ad.user_id;
    const assetSymbol = (ad.asset_symbol || ad.crypto || ad.asset || '').toUpperCase();
    if (!assetSymbol) {
      return {
        data: null,
        error: { message: 'Advertisement asset is missing.', code: 'AD_ASSET_INVALID' },
      };
    }

    // The wallet_assets escrow RPC is the authoritative concurrent balance check.
    // Do not expose a balance from a legacy table as a trade availability guarantee.
    const creatorCryptoBalance = Number(ad.total_amount ?? ad.available_amount ?? 0);

    // 7. Fetch trade statistics for the ad creator
    let totalTrades = Math.max(0, Number(profileData?.total_trades ?? profileData?.completed_trades ?? 0) || 0);
    let completedTrades = Math.max(0, Number(profileData?.completed_trades ?? 0) || 0);
    let totalReleaseMinutes = 0;

    if (sellerId) {
      try {
        const { data: trades, error: tradesError } = await adminClient
          .from('trades')
          .select('created_at, resolved_at, status')
          .or(`seller_id.eq.${sellerId},buyer_id.eq.${sellerId}`);

        if (!tradesError && trades && trades.length > 0) {
          totalTrades = trades.length;

          const completed = trades.filter((t: any) => {
            const s = String(t.status || '').toLowerCase();
            return ['completed', 'resolved', 'paid', 'settled'].includes(s) && t.resolved_at;
          });

          completedTrades = completed.length;

          totalReleaseMinutes = completed.reduce((acc: number, t: any) => {
            const start = new Date(t.created_at).getTime();
            const end = new Date(t.resolved_at).getTime();
            const durationMinutes = (end - start) / (1000 * 60);
            return acc + (durationMinutes > 0 ? durationMinutes : 0);
          }, 0);
        }
      } catch (tradeStatsErr) {
        console.warn('Failed to fetch trade stats:', tradeStatsErr);
      }
    }

    const avgReleaseTime = completedTrades > 0 && totalReleaseMinutes > 0
      ? totalReleaseMinutes / completedTrades
      : Number(profileData?.avg_release_minutes ?? 0);
    const completionRate = totalTrades > 0
      ? (completedTrades / totalTrades) * 100
      : 0;

    // 8. Return normalized, type-safe payload
    const normalizedProfile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user || profileData;

    return {
      data: {
        ...ad,
        creator_crypto_balance: creatorCryptoBalance,
        profiles: normalizedProfile || null,
        user: normalizedProfile || null,
        sellerStats: {
          totalTrades,
          completedTrades,
          completionRate: Number(completionRate),
          avgReleaseTime: Number(avgReleaseTime),
        },
      },
      error: null,
    };
  } catch (err: any) {
    console.error(`[Ad Load Server Action Exception - ID: ${adId}]:`, err);
    return {
      data: null,
      error: {
        message: err?.message || 'An unexpected error occurred while fetching ad details.',
      },
    };
  }
}

export async function createAd(formData: any): Promise<ActionResponse<any>> {
  try {
    const supabase = await createClient();
    const adminClient = getSupabaseAdminClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        data: null,
        error: {
          message: 'User authentication required to create an advertisement.',
          code: 'UNAUTHORIZED',
        },
      };
    }

    const userId = user.id;

    // Check platform controls for creating new ads
    try {
      await assertPlatformControlAllowed('new_ad', { userId });
    } catch (guardErr: any) {
      return {
        data: null,
        error: {
          message: guardErr.message || 'Creating new advertisements is temporarily disabled.',
          code: guardErr.code || 'PLATFORM_AD_CREATION_DISABLED',
        },
      };
    }

    const adTypeResolved = String(formData.type || formData.adType || 'SELL').toUpperCase();
    if (adTypeResolved !== 'BUY' && adTypeResolved !== 'SELL') {
      return {
        data: null,
        error: { message: 'Advertisement direction must be BUY or SELL.', code: 'INVALID_AD_DIRECTION' },
      };
    }

    // Every other ad-creation entry point rejects SELL until wallet inventory is
    // reserved atomically with ad creation and consumed by the escrow RPC. Keep
    // this server action on the same fail-closed contract; KYC alone is not a
    // substitute for reserving the advertised crypto balance.
    if (adTypeResolved === 'SELL') {
      return {
        data: null,
        error: {
          message: 'SELL advertisements are temporarily unavailable until atomic wallet inventory reservation is enabled.',
          code: 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED',
        },
      };
    }

    // This legacy server action used to INSERT directly into public.ads. That
    // path bypassed the canonical pricing, FX, account and dual-table checks.
    // All supported callers must use the validated /api/p2p/ads endpoint.
    return {
      data: null,
      error: {
        message: 'This legacy ad-creation action is retired. Use the canonical marketplace ad-creation flow.',
        code: 'LEGACY_AD_CREATE_ACTION_RETIRED',
      },
    };
  } catch (err: any) {
    return {
      data: null,
      error: {
        message: err?.message || 'An unexpected error occurred while creating the ad.',
      },
    };
  }
}

export async function createTradeOrderWithEscrow(input: {
  adId: string;
  fiatAmount: number;
  paymentMethod?: string;
  idempotencyKey?: string;
  tradeRef?: string;
}): Promise<ActionResponse<{ orderId: string }>> {
  try {
    const supabase = await createClient();
    const adminClient = getSupabaseAdminClient();

    // 1. Validate Auth Session
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        data: null,
        error: { message: 'Please log in to initiate a trade.', code: '401' },
      };
    }

    // Check platform controls for initiating new trades
    try {
      await assertPlatformControlAllowed('trade', { userId: user.id });
    } catch (guardErr: any) {
      return {
        data: null,
        error: {
          message: guardErr.message || 'Initiating new trades is temporarily disabled.',
          code: guardErr.code || 'PLATFORM_TRADING_DISABLED',
        },
      };
    }

    // 2. Fetch Ad details safely using universal resolver
    const cleanAdId = String(input.adId || '').replace(/^#/, '').trim();
    let ad: any = null;
    let validAdUuid: string | null = null;

    const resolved = await findAdById(cleanAdId);
    if (resolved?.ad) {
      ad = resolved.ad;
      if (isValidUUID(ad.id)) {
        validAdUuid = ad.id;
      }
    }

    // Fail closed: never synthesize an advertisement when the requested ad does not exist.
    // Creating escrow against fabricated ad data could lock funds without a valid offer.
    if (!ad) {
      return {
        data: null,
        error: {
          message: 'Advertisement not found or no longer available.',
          code: 'AD_NOT_FOUND',
        },
      };
    }

    const resolvedPublicId = String(ad.public_ad_id || ad.public_id || ad.id || cleanAdId);


    // Rule: Users cannot open trades on their own ads (unless it is a system/demo ad)
    if (ad.user_id === user.id && ad.user_id !== 'trader_verified_1') {
      return {
        data: null,
        error: {
          message: 'You cannot initiate a trade on your own advertisement.',
          code: '400',
        },
      };
    }

    if (ad.is_active === false || ad.active === false || ad.status === 'INACTIVE') {
      return {
        data: null,
        error: {
          message: 'This advertisement is currently inactive.',
          code: '400',
        },
      };
    }

    // Fees and minimums come from the single canonical app_settings contract.
    // Never silently substitute a default when a financial control is unavailable.
    let minTradeAmount: number;
    try {
      const feeSettings = await getPlatformFeeSettings();
      minTradeAmount = feeSettings.minTradeAmount;
    } catch (feeError) {
      console.error('[createTradeOrderWithEscrow] Unable to verify platform fee settings:', feeError);
      return {
        data: null,
        error: {
          message: 'Trade fee settings are temporarily unavailable. Please retry.',
          code: 'TRADE_FEE_CONFIG_UNAVAILABLE',
        },
      };
    }

    // Use only the persisted ad price/limits. Never synthesize a price or amount range.
    const price = Number(ad.price ?? ad.fixed_rate ?? ad.fixedRate ?? ad.unit_price);
    const fiatAmount = Number(input.fiatAmount);
    const minLimit = Number(ad.min_limit ?? ad.min_amount);
    const maxLimit = Number(ad.max_limit ?? ad.max_amount);

    if (!Number.isFinite(price) || price <= 0) {
      return {
        data: null,
        error: { message: 'Advertisement has an invalid price.', code: 'AD_PRICE_INVALID' },
      };
    }
    if (!Number.isFinite(minLimit) || minLimit <= 0 || !Number.isFinite(maxLimit) || maxLimit < minLimit) {
      return {
        data: null,
        error: { message: 'Advertisement order limits are missing or invalid.', code: 'AD_LIMITS_INVALID' },
      };
    }
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
      return {
        data: null,
        error: { message: 'Trade amount must be a positive number.', code: 'TRADE_AMOUNT_INVALID' },
      };
    }
    if (String(ad.fiat_symbol || ad.fiat || ad.fiat_currency || 'USD').toUpperCase() === 'USD' && fiatAmount < minTradeAmount) {
      return {
        data: null,
        error: { message: `Minimum trade amount is ${minTradeAmount} USD.`, code: 'MIN_TRADE_AMOUNT_NOT_MET' },
      };
    }
    const assetSymbol = (ad.asset_symbol || ad.crypto || ad.asset_code || 'BTC').toUpperCase();
    const fiatSymbol = (ad.fiat_symbol || ad.fiat || ad.fiat_currency || 'USD').toUpperCase();

    // 5. Determine who is providing crypto for escrow:
    const typeCandidates = [
      ad.trade_type,
      ad.ad_type,
      ad.side,
      ad.adType,
      ad.type,
    ].filter(Boolean).map((s: any) => String(s).toUpperCase());

    const isBuyAd = typeCandidates.some((t: string) => t === 'BUY' || t === 'ONLINE_BUY' || t.includes('BUY'));
    const isInitiatorSelling = isBuyAd;


    const adOwnerId = ad.user_id || ad.seller_id || ad.advertiser_id || (ad.profiles && ad.profiles.id);
    if (typeof adOwnerId !== 'string' || !adOwnerId.trim()) {
      return {
        data: null,
        error: { message: 'Advertisement owner could not be verified.', code: 'AD_OWNER_UNAVAILABLE' },
      };
    }
    const sellerId = isInitiatorSelling ? user.id : adOwnerId;
    const buyerId = isInitiatorSelling ? adOwnerId : user.id;
    const resolvedSellerId = sellerId;
    const resolvedBuyerId = buyerId;

    // 5.1 Enforce KYC Tier 1 / Tier 2 Business Rules
    // Seller MUST be Tier 2
    const { data: sellerProf } = await adminClient
      .from('profiles')
      .select('is_verified, id_verified, kyc_status, verification_tier')
      .eq('id', sellerId)
      .maybeSingle();

    const isSellerTier2 = isTier2User(sellerProf);

    if (!isSellerTier2) {
      return {
        data: null,
        error: {
          message: 'KYC verification is required to sell.',
          code: 'KYC_REQUIRED',
        },
      };
    }

    // Buyer: If Tier 1, cumulative BUY volume capped at $1,000.00
    const { data: buyerProf } = await adminClient
      .from('profiles')
      .select('is_verified, id_verified, kyc_status, verification_tier')
      .eq('id', buyerId)
      .maybeSingle();

    const isBuyerTier2 = isTier2User(buyerProf);

    if (!isBuyerTier2) {
      const { data: existingBuyerTrades } = await adminClient
        .from('trades')
        .select('fiat_amount, crypto_amount, price, unit_price, status')
        .eq('buyer_id', buyerId);

      const NON_QUALIFYING = new Set(['cancelled', 'canceled', 'expired', 'failed', 'rejected']);
      let cumBuys = 0;
      for (const t of existingBuyerTrades || []) {
        if (!NON_QUALIFYING.has(String(t.status || '').toLowerCase().trim())) {
          cumBuys += Number(t.fiat_amount) || (Number(t.crypto_amount || 0) * Number(t.price ?? t.unit_price ?? 1.0));
        }
      }

      if ((cumBuys + fiatAmount) > 1000.00) {
        return {
          data: null,
          error: {
            message: 'Tier 1 accounts can buy up to $1,000 cumulatively. Complete KYC to increase your buy limit.',
            code: 'KYC_TIER1_BUY_LIMIT_EXCEEDED',
          },
        };
      }
    }

    // Validate the advertisement's published order limits. The canonical database
    // RPC performs the authoritative concurrent wallet_assets lock and escrow check;
    // do not use a max-of-legacy-wallet-tables preflight as a substitute for that lock.
    if (fiatAmount < minLimit || fiatAmount > maxLimit) {
      return {
        data: null,
        error: {
          message: `Trade amount must be between ${minLimit.toLocaleString()} and ${maxLimit.toLocaleString()} ${fiatSymbol}.`,
          code: 'TRADE_LIMIT_EXCEEDED',
        },
      };
    }

    const baseCryptoAmount = Number((fiatAmount / price).toFixed(8));
    if (!Number.isFinite(baseCryptoAmount) || baseCryptoAmount <= 0) {
      return {
        data: null,
        error: { message: 'Trade amount is below the supported precision.', code: 'TRADE_AMOUNT_PRECISION' },
      };
    }

    // 7. Resolve Payment Method
    let rawPaymentMethods: any[] = [];
    if (Array.isArray(ad.payment_methods)) {
      rawPaymentMethods = ad.payment_methods;
    } else if (typeof ad.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(ad.payment_methods);
        rawPaymentMethods = Array.isArray(parsed) ? parsed : [ad.payment_methods];
      } catch {
        rawPaymentMethods = [ad.payment_methods];
      }
    } else if (ad.payment_method) {
      rawPaymentMethods = [ad.payment_method];
    }

    const paymentMethods: string[] = rawPaymentMethods.filter((m: any) => typeof m === 'string' && m.trim().length > 0);
    if (paymentMethods.length === 0) {
      return {
        data: null,
        error: { message: 'Advertisement has no configured payment methods.', code: 'AD_PAYMENT_METHODS_MISSING' },
      };
    }
    let resolvedPaymentMethod = '';
    const trimmedInputMethod = typeof input.paymentMethod === 'string' ? input.paymentMethod.trim() : '';

    if (paymentMethods.length > 1) {
      if (!trimmedInputMethod) {
        return {
          data: null,
          error: { message: 'Please select a payment method for this advertisement.', code: '400' },
        };
      }
      const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedInputMethod.toLowerCase());
      if (!matched) {
        return {
          data: null,
          error: { message: `Selected payment method "${trimmedInputMethod}" is not supported by this advertisement.`, code: '400' },
        };
      }
      resolvedPaymentMethod = matched;
    } else if (paymentMethods.length === 1) {
      if (trimmedInputMethod) {
        const matched = paymentMethods.find((m) => m.trim().toLowerCase() === trimmedInputMethod.toLowerCase());
        if (!matched) {
          return {
            data: null,
            error: { message: `Selected payment method "${trimmedInputMethod}" is not supported by this advertisement.`, code: '400' },
          };
        }
        resolvedPaymentMethod = matched;
      } else {
        resolvedPaymentMethod = paymentMethods[0];
      }
    } else {
      resolvedPaymentMethod = trimmedInputMethod || 'Bank Transfer';
    }

    // 8. Execute Atomic Escrow Lock & Trade Creation via Canonical Database RPC
    const shortTradeId = input.tradeRef || generateTradeId();
    const resolvedIdempotencyKey = input.idempotencyKey?.trim();
    if (!resolvedIdempotencyKey) {
      return {
        data: null,
        error: { message: 'Idempotency key is required to initiate trade order.', code: 'IDEMPOTENCY_KEY_REQUIRED' },
      };
    }
    const adIdentifier = String(ad.id || ad.public_ad_id || ad.public_id || cleanAdId);

    const { data: rpcResult, error: rpcError } = await adminClient.rpc('initiate_trade_with_escrow', {
      p_ad_id: adIdentifier,
      p_crypto_amount: baseCryptoAmount,
      p_fiat_amount: fiatAmount,
      p_fiat_currency: fiatSymbol,
      p_price: price,
      p_payment_method: resolvedPaymentMethod,
      p_trade_ref: shortTradeId,
      p_idempotency_key: resolvedIdempotencyKey,
      p_caller_id: user.id,
    });

    if (rpcError) {
      console.error('[createTradeOrderWithEscrow] RPC initiate_trade_with_escrow error:', rpcError);
      return {
        data: null,
        error: {
          message: rpcError.message || 'Failed to initiate trade and lock escrow.',
          code: rpcError.code === 'P0001' ? 'INSUFFICIENT_FUNDS' : 'ESCROW_ERROR',
        },
      };
    }

    if (!rpcResult || rpcResult.success === false) {
      return {
        data: null,
        error: {
          message: rpcResult?.message || 'Failed to initiate trade with escrow.',
          code: 'ESCROW_FAILED',
        },
      };
    }

    const tradeId = rpcResult.trade_id || rpcResult.id;
    if (!tradeId) {
      return {
        data: null,
        error: {
          message: 'Failed to obtain trade ID from escrow lock response.',
          code: '500',
        },
      };
    }

    // 9. Insert Activity Center In-App Notifications for counterparties
    try {
      const nowIso = new Date().toISOString();
      const formattedCoin = String(rpcResult.asset || assetSymbol || 'USDT').toUpperCase();
      const cryptoVal = Number(rpcResult.crypto_amount ?? baseCryptoAmount);
      const fiatVal = Number(rpcResult.fiat_amount ?? fiatAmount);
      const fiatCurr = String(rpcResult.fiat_currency || fiatSymbol || 'USD').toUpperCase();
      const tradeLink = `/trade/${resolvedPublicId || tradeId}`;

      // Prevent duplicate trade-created notifications on retry
      const { data: existingNotifs } = await adminClient
        .from('notifications')
        .select('id, user_id')
        .eq('metadata->>link', tradeLink)
        .eq('type', 'trade_initiated')
        .limit(2);

      const notifiedUsers = new Set((existingNotifs || []).map((n: any) => n.user_id));

      if (resolvedSellerId && !notifiedUsers.has(resolvedSellerId)) {
        await adminClient.from('notifications').insert({
          user_id: resolvedSellerId,
          title: 'Trade Request Initiated',
          message: `New trade #${resolvedPublicId} opened: ${cryptoVal.toFixed(4)} ${formattedCoin} for ${fiatVal.toFixed(2)} ${fiatCurr}.`,
          type: 'trade_initiated',
          is_read: false,
          read: false,
          metadata: { link: tradeLink },
          created_at: nowIso,
        });
      }

      if (resolvedBuyerId && resolvedBuyerId !== resolvedSellerId && !notifiedUsers.has(resolvedBuyerId)) {
        await adminClient.from('notifications').insert({
          user_id: resolvedBuyerId,
          title: 'Trade Request Initiated',
          message: `Trade #${resolvedPublicId} opened successfully. Awaiting payment/escrow confirmation.`,
          type: 'trade_initiated',
          is_read: false,
          read: false,
          metadata: { link: tradeLink },
          created_at: nowIso,
        });
      }
    } catch (notifErr) {
      console.warn('[createTradeOrderWithEscrow] Notification creation notice:', notifErr);
    }

    // 10. Dispatch Non-blocking Email Notification to Counterparties
    void sendNewTradeNotificationEmail({
      tradeId: String(tradeId),
      publicId: resolvedPublicId,
      sellerId: resolvedSellerId,
      buyerId: resolvedBuyerId,
      cryptoAmount: Number(rpcResult.crypto_amount ?? baseCryptoAmount),
      fiatAmount: Number(rpcResult.fiat_amount ?? fiatAmount),
      fiatCurrency: String(rpcResult.fiat_currency || fiatSymbol),
      asset: String(rpcResult.asset || assetSymbol),
      price: Number(price),
      paymentMethod: String(resolvedPaymentMethod),
      status: 'pending',
      createdAt: new Date().toISOString(),
    }).then((result) => {
      if (!result.success) {
        console.error(
          '[createTradeOrderWithEscrow] Email notification failure:',
          result.error
        );
      }
    }).catch((emailErr) => {
      console.error(
        '[createTradeOrderWithEscrow] Email notification exception:',
        emailErr
      );
    });

    return { data: { orderId: tradeId }, error: null };
  } catch (err: any) {
    console.error('[CreateTradeOrder Exception]:', err);
    return { data: null, error: { message: err?.message || 'Server error occurred during trade creation.', code: '500' } };
  }
}

export async function createTradeOrder(input: {
  adId: string;
  fiatAmount: number;
  paymentMethod?: string;
}): Promise<ActionResponse<{ orderId: string }>> {
  return createTradeOrderWithEscrow(input);
}

