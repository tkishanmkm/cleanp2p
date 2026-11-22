import { NextResponse } from 'next/server';

/**
 * The legacy p2p_orders model has no PAID status and does not own the
 * canonical wallet_assets escrow settlement. Do not mutate financial state
 * through this endpoint. Trade status and settlement must go through the
 * canonical trade-action RPC path until the order/trade models are unified.
 */
export async function PATCH() {
  return NextResponse.json(
    {
      error: 'This legacy order status endpoint is disabled. Use the canonical P2P trade action flow for payment and settlement.',
      code: 'LEGACY_ORDER_STATUS_DISABLED',
    },
    { status: 410 }
  );
}
