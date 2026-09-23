import { getSupabaseAdminClient } from '@/lib/supabase/server';

export interface CreateTradeWithEscrowParams {
  adId: string;
  cryptoAmount: number;
  fiatAmount: number;
  fiatCurrency: string;
  price: number;
  paymentMethod: string;
  tradeRef?: string;
  idempotencyKey?: string;
}

/**
 * Canonical Atomic Escrow Lock and Trade Creation Service Handler
 * Delegates exclusively to the database RPC public.initiate_trade_with_escrow.
 * Fails closed without fallbacks or direct wallet mutations.
 */
export async function createTradeWithEscrow({
  adId,
  cryptoAmount,
  fiatAmount,
  fiatCurrency,
  price,
  paymentMethod,
  tradeRef,
  idempotencyKey,
}: CreateTradeWithEscrowParams) {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase.rpc('initiate_trade_with_escrow', {
    p_ad_id: String(adId),
    p_crypto_amount: Number(cryptoAmount),
    p_fiat_amount: Number(fiatAmount),
    p_fiat_currency: String(fiatCurrency),
    p_price: Number(price),
    p_payment_method: String(paymentMethod),
    p_trade_ref: tradeRef ?? null,
    p_idempotency_key: idempotencyKey ?? null,
  });

  if (error) {
    console.error('[EscrowService] initiate_trade_with_escrow RPC error:', error);
    throw new Error(error.message || 'Failed to initiate trade with escrow.');
  }

  if (!data || data.success === false) {
    throw new Error(data?.message || 'Failed to initiate trade with escrow.');
  }

  return data;
}
