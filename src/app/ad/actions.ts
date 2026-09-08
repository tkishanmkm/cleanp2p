'use server';

import { createClient } from '@/lib/supabase/server';

export interface ActionResponse<T> {
  data: T | null;
  error: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null;
}

export async function getMarketplaceAds(tradeType: 'BUY' | 'SELL' | 'buy' | 'sell'): Promise<ActionResponse<any[]>> {
  try {
    const supabase = await createClient();
    const queryTradeType = tradeType.toUpperCase();

    // Query linking ads.user_id -> profiles.id
    const { data: ads, error } = await supabase
      .from('ads')
      .select(`
        *,
        profiles!user_id (
          id,
          username,
          avatar_url,
          is_online,
          last_seen,
          created_at
        )
      `)
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

    const formattedAds = (ads || []).map((ad) => {
      const profileRecord = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user;
      return {
        ...ad,
        profiles: profileRecord || null,
        user: profileRecord || null,
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
    const supabase = await createClient();

    // 1. Fetch Ad details with linked Profile safely using .maybeSingle()
    const { data: ad, error: adError } = await supabase
      .from('ads')
      .select(`
        *,
        profiles!user_id (
          id,
          username,
          avatar_url,
          is_online,
          last_seen,
          created_at
        )
      `)
      .eq('id', adId)
      .maybeSingle();

    if (adError) {
      console.error(`[Ad Load Supabase Error - ID: ${adId}]:`, adError);
      return {
        data: null,
        error: {
          message: adError.message,
          code: adError.code,
          details: adError.details,
          hint: adError.hint,
        },
      };
    }

    if (!ad) {
      return {
        data: null,
        error: {
          message: 'The requested advertisement was not found or may have been removed.',
          code: '404',
        },
      };
    }

    const sellerId = ad.user_id;

    // 2. Fetch trader's current wallet balance for the ad asset to calculate real available limit
    let creatorCryptoBalance = Number(ad.total_amount || 0);
    const assetSymbol = (ad.asset_symbol || ad.crypto || 'USDT').toUpperCase();

    if (sellerId) {
      try {
        const { data: creatorWallet } = await supabase
          .from('wallet_assets')
          .select('available, balance, amount')
          .eq('user_id', sellerId)
          .eq('asset_symbol', assetSymbol)
          .maybeSingle();

        if (creatorWallet) {
          const avail = Number(creatorWallet.available ?? creatorWallet.balance ?? creatorWallet.amount ?? 0);
          if (!isNaN(avail) && avail > 0) {
            creatorCryptoBalance = avail;
          }
        }
      } catch (err) {
        console.warn('Failed to fetch creator wallet balance:', err);
      }
    }

    // 3. Fetch trade statistics for the ad creator safely
    let totalTrades = 0;
    let completedTrades = 0;
    let totalReleaseMinutes = 0;

    if (sellerId) {
      const { data: trades, error: tradesError } = await supabase
        .from('trades')
        .select('created_at, resolved_at, status')
        .or(`seller_id.eq.${sellerId},buyer_id.eq.${sellerId}`);

      if (!tradesError && trades) {
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
    }

    const avgReleaseTime = completedTrades > 0 ? totalReleaseMinutes / completedTrades : 0;
    const completionRate = totalTrades > 0 ? (completedTrades / totalTrades) * 100 : 0;

    // 4. Return normalized, type-safe payload
    const normalizedProfile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user;

    return {
      data: {
        ...ad,
        creator_crypto_balance: creatorCryptoBalance,
        profiles: normalizedProfile || null,
        user: normalizedProfile || null,
        sellerStats: {
          totalTrades,
          completedTrades,
          completionRate: Number(completionRate) || 0,
          avgReleaseTime: Number(avgReleaseTime) || 0,
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

    const auth = await supabase.auth.getUser();
    const userId = formData.userId || formData.user_id || auth.data?.user?.id;

    if (!userId) {
      return {
        data: null,
        error: {
          message: 'User authentication required to create an advertisement.',
          code: 'UNAUTHORIZED',
        },
      };
    }

    const { data, error } = await supabase
      .from('ads')
      .insert({
        user_id: userId,
        type: formData.type || formData.adType || 'SELL',
        asset_symbol: formData.crypto || formData.asset_symbol || 'USDT',
        fiat_symbol: formData.fiat || formData.fiat_symbol || 'USD',
        price: formData.price ? Number(formData.price) : 0,
        total_amount: formData.totalAmount || formData.total_amount ? Number(formData.totalAmount || formData.total_amount) : 0,
        min_limit: formData.minLimit || formData.min_limit ? Number(formData.minLimit || formData.min_limit) : 0,
        max_limit: formData.maxLimit || formData.max_limit ? Number(formData.maxLimit || formData.max_limit) : 0,
        payment_methods: formData.paymentMethods || formData.payment_methods || [],
        ad_tags: formData.tags || formData.ad_tags || [],
        terms: formData.terms || formData.instructions || '',
        is_active: true,
      })
      .select()
      .single();

    if (error) {
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

    return { data, error: null };
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
}): Promise<ActionResponse<{ orderId: string }>> {
  try {
    const supabase = await createClient();

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

    // 2. Fetch Ad details
    const { data: ad, error: adError } = await supabase
      .from('ads')
      .select('*')
      .eq('id', input.adId)
      .maybeSingle();

    if (adError || !ad) {
      return { data: null, error: { message: 'Advertisement not found or unavailable.', code: '404' } };
    }

    // Rule: Users cannot open trades on their own ads
    if (ad.user_id === user.id) {
      return {
        data: null,
        error: {
          message: 'You cannot initiate a trade on your own advertisement.',
          code: '400',
        },
      };
    }

    if (ad.is_active === false) {
      return {
        data: null,
        error: {
          message: 'This advertisement is currently inactive.',
          code: '400',
        },
      };
    }

    // 3. Get Dynamic Escrow Fee from settings (Fallback to 1.5%)
    let escrowFeePercent = 1.5;
    try {
      const { data: feeSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'escrow_fee_percent')
        .maybeSingle();

      if (feeSetting?.value) {
        escrowFeePercent = Number(feeSetting.value) || 1.5;
      }
    } catch {
      escrowFeePercent = 1.5;
    }

    // 4. Calculate Base Amounts & Limits
    const price = Number(ad.price || ad.fixed_rate || ad.fixedRate) || 80116.02;
    const fiatAmount = Number(input.fiatAmount);
    const minLimit = Number(ad.min_limit ?? ad.min_amount ?? 100) || 100;
    const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? 5000) || 5000;
    const assetSymbol = (ad.asset_symbol || ad.crypto || 'USDT').toUpperCase();
    const fiatSymbol = (ad.fiat_symbol || ad.fiat || 'USD').toUpperCase();

    const isAdSell = String(ad.type || ad.ad_type || ad.adType || '').toUpperCase() === 'SELL';
    const isInitiatorSelling = !isAdSell; // On a BUY ad, the initiator is selling crypto. On a SELL ad, the advertiser is selling crypto.

    // 5. Check Advertiser Balance if it's a SELL ad to determine effective available limit
    let effectiveMaxLimit = maxLimit;
    if (isAdSell) {
      const { data: advertiserWallet } = await supabase
        .from('wallet_assets')
        .select('available, balance, amount')
        .eq('user_id', ad.user_id)
        .eq('asset_symbol', assetSymbol)
        .maybeSingle();

      const advertiserCryptoBalance = Number(
        advertiserWallet?.available ?? advertiserWallet?.balance ?? advertiserWallet?.amount ?? ad.total_amount ?? 0
      );

      const advertiserMaxFiat = advertiserCryptoBalance > 0 && price > 0 ? advertiserCryptoBalance * price : maxLimit;
      effectiveMaxLimit = Math.min(maxLimit, advertiserMaxFiat > 0 ? advertiserMaxFiat : maxLimit);
    }

    // Validate trade limits
    if (fiatAmount < minLimit || fiatAmount > effectiveMaxLimit) {
      return {
        data: null,
        error: {
          message: `Trade amount must be between ${minLimit.toLocaleString()} and ${effectiveMaxLimit.toLocaleString()} ${fiatSymbol}.`,
          code: '400',
        },
      };
    }

    const baseCryptoAmount = price > 0 ? Number((fiatAmount / price).toFixed(6)) : 0;
    const escrowFeeCrypto = Number(((baseCryptoAmount * escrowFeePercent) / 100).toFixed(6));
    const totalCryptoRequiredForSeller = Number((baseCryptoAmount + escrowFeeCrypto).toFixed(6));

    // 6. REAL-TIME FUNDING & BALANCE VERIFICATION
    // Determine who is providing crypto for escrow:
    // If BUY ad: The initiating user is the seller and must have available crypto + 1.5% fee
    // If SELL ad: The advertiser is the seller and must have available crypto + 1.5% fee
    const sellerId = isAdSell ? ad.user_id : user.id;
    const buyerId = isAdSell ? user.id : ad.user_id;

    const { data: sellerWallet, error: walletError } = await supabase
      .from('wallet_assets')
      .select('id, available, balance, amount, locked_escrow, locked')
      .eq('user_id', sellerId)
      .eq('asset_symbol', assetSymbol)
      .maybeSingle();

    const currentSellerAvail = Number(
      sellerWallet?.available ?? sellerWallet?.balance ?? sellerWallet?.amount ?? (isAdSell ? ad.total_amount : 0)
    );

    if (currentSellerAvail < totalCryptoRequiredForSeller) {
      const msg = isInitiatorSelling
        ? `Insufficient wallet balance. You need ${totalCryptoRequiredForSeller.toFixed(6)} ${assetSymbol} (including ${escrowFeePercent}% escrow fee) to initiate this trade.`
        : `The advertiser does not have enough available balance to fund this trade right now.`;
      return {
        data: null,
        error: { message: msg, code: 'INSUFFICIENT_FUNDS' },
      };
    }

    // 7. Lock escrow & insert trade record
    if (sellerWallet?.id) {
      const currentLocked = Number(sellerWallet.locked_escrow ?? sellerWallet.locked ?? 0);
      const newAvail = Math.max(0, currentSellerAvail - totalCryptoRequiredForSeller);
      const newLocked = currentLocked + totalCryptoRequiredForSeller;

      await supabase
        .from('wallet_assets')
        .update({
          available: newAvail,
          locked_escrow: newLocked,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sellerWallet.id);
    }

    const { data: order, error: orderError } = await supabase
      .from('trades')
      .insert({
        ad_id: ad.id,
        buyer_id: buyerId,
        seller_id: sellerId,
        price,
        fiat_amount: fiatAmount,
        crypto_amount: baseCryptoAmount,
        escrow_fee_crypto: escrowFeeCrypto,
        escrow_fee_percent: escrowFeePercent,
        total_locked_crypto: totalCryptoRequiredForSeller,
        asset_symbol: assetSymbol,
        fiat_symbol: fiatSymbol,
        status: 'PENDING',
      })
      .select('id')
      .single();

    if (orderError) {
      // Rollback locked balance if trade insertion fails
      if (sellerWallet?.id) {
        await supabase
          .from('wallet_assets')
          .update({
            available: currentSellerAvail,
            updated_at: new Date().toISOString(),
          })
          .eq('id', sellerWallet.id);
      }
      return { data: null, error: { message: orderError.message, code: '500' } };
    }

    return { data: { orderId: order.id }, error: null };
  } catch (err: any) {
    return { data: null, error: { message: err?.message || 'Server error occurred during trade creation.', code: '500' } };
  }
}

export async function createTradeOrder(input: {
  adId: string;
  fiatAmount: number;
}): Promise<ActionResponse<{ orderId: string }>> {
  return createTradeOrderWithEscrow(input);
}
