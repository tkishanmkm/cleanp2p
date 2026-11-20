import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export class P2PEscrowService {
  /**
   * Legacy compatibility helper.
   *
   * No current application call sites use this service. Escrow reservation and
   * release must go through the canonical actor-bound trade RPCs and the
   * withdrawal/sweep receipt pipeline, not this legacy P2P mirror table.
   */
  static async lockTradeEscrow(tradeId: string, sellerId: string, amountUnits: number) {
    const supabase = getSupabaseAdminClient();

    const { error } = await supabase.rpc('lock_p2p_escrow', {
      p_trade_id: tradeId,
      p_seller_id: sellerId,
      p_amount: amountUnits,
    });

    if (error) {
      throw new Error(`Escrow lock failed: ${error.message}`);
    }

    return { success: true };
  }

  /**
   * Retired legacy path.
   *
   * The previous implementation broadcast a hot-wallet transfer directly
   * from a p2p_trades row and then updated that mirror without the canonical
   * trade settlement / durable receipt-proof workflow. Keep the method
   * signature for compile-time compatibility, but fail closed.
   */
  static async releaseTradeEscrow(_tradeId: string, _sellerUserId: string): Promise<never> {
    throw new Error(
      'Legacy direct hot-wallet escrow release is disabled. Use the canonical authenticated trade settlement workflow.'
    );
  }
}
