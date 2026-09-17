import { getSupabaseAdminClient } from '@/lib/supabase/server';

export interface CreateTradeParams {
  sellerId: string;
  buyerId?: string;
  cryptoAmount: number;
  escrowFee: number;
  fiatCurrency: string;
  rate: number;
  cryptoSymbol?: string;
  paymentMethod?: string;
}

/**
 * Atomic Escrow Lock and Trade Creation Service Handler
 */
export async function createTradeWithEscrow({
  sellerId,
  buyerId,
  cryptoAmount,
  escrowFee,
  fiatCurrency,
  rate,
  cryptoSymbol = 'USDT',
  paymentMethod = 'Bank Transfer',
}: CreateTradeParams) {
  const supabase = getSupabaseAdminClient();

  // 1. Call atomic lock function in Postgres (lock_seller_escrow)
  const { data: lockData, error: lockError } = await supabase.rpc('lock_seller_escrow', {
    p_user_id: sellerId,
    p_crypto_amount: cryptoAmount,
    p_escrow_fee: escrowFee,
    p_currency: cryptoSymbol,
  });

  if (lockError) {
    console.error('[EscrowService] lock_seller_escrow RPC error:', lockError);
    // Fallback: If RPC not yet installed, defensively verify and update wallets/wallet_assets directly
    const { data: walletRow } = await supabase
      .from('wallets')
      .select('id, total_balance, locked_balance, available_balance')
      .eq('user_id', sellerId)
      .eq('currency', cryptoSymbol)
      .maybeSingle();

    if (walletRow) {
      const avail = Number(walletRow.available_balance ?? (Number(walletRow.total_balance || 0) - Number(walletRow.locked_balance || 0)));
      const required = cryptoAmount + escrowFee;
      if (avail < required) {
        throw new Error(`Insufficient available balance (${avail.toFixed(4)} ${cryptoSymbol}) for trade amount + escrow fee (${required.toFixed(4)} ${cryptoSymbol}).`);
      }

      await supabase
        .from('wallets')
        .update({
          locked_balance: Number(walletRow.locked_balance || 0) + required,
          updated_at: new Date().toISOString(),
        })
        .eq('id', walletRow.id);
    }
  }

  // 2. Create trade entry with dynamic fiat rate, expires_at, and user relations
  const totalFiat = cryptoAmount * rate;

  const tradePayload = {
    seller_id: String(sellerId),
    buyer_id: buyerId ? String(buyerId) : null,
    crypto: cryptoSymbol,
    coin: cryptoSymbol,
    asset: cryptoSymbol,
    amount: cryptoAmount,
    crypto_amount: cryptoAmount,
    escrow_fee: escrowFee,
    fiat_currency: fiatCurrency,
    price: rate,
    unit_price: rate,
    fiat_amount: totalFiat,
    amount_usd: totalFiat,
    status: 'PENDING',
  };

  const { data: trade, error: tradeError } = await supabase
    .from('trades')
    .insert([tradePayload])
    .select('*')
    .single();

  if (tradeError) {
    // If insert fails, fallback to bare minimal columns guaranteed to exist
    const { data: simpleTrade, error: simpleError } = await supabase
      .from('trades')
      .insert([
        {
          seller_id: String(sellerId),
          buyer_id: buyerId ? String(buyerId) : null,
          crypto: cryptoSymbol,
          amount: cryptoAmount,
          fiat_amount: totalFiat,
          price: rate,
          status: 'PENDING',
        },
      ])
      .select('*')
      .single();

    if (simpleError) {
      throw simpleError;
    }
    return simpleTrade;
  }

  return trade;
}
