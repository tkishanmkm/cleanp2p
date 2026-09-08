'use server';

import {
  createTradeOrder as createTradeOrderAction,
  createTradeOrderWithEscrow as createTradeOrderWithEscrowAction,
  getAdDetails as getAdDetailsAction,
  getMarketplaceAds as getMarketplaceAdsAction,
  createAd as createAdAction,
} from '@/app/ad/actions';

export async function createTradeOrder(...args: Parameters<typeof createTradeOrderAction>) {
  return createTradeOrderAction(...args);
}

export async function createTradeOrderWithEscrow(...args: Parameters<typeof createTradeOrderWithEscrowAction>) {
  return createTradeOrderWithEscrowAction(...args);
}

export async function getAdDetails(...args: Parameters<typeof getAdDetailsAction>) {
  return getAdDetailsAction(...args);
}

export async function getMarketplaceAds(...args: Parameters<typeof getMarketplaceAdsAction>) {
  return getMarketplaceAdsAction(...args);
}

export async function createAd(...args: Parameters<typeof createAdAction>) {
  return createAdAction(...args);
}
