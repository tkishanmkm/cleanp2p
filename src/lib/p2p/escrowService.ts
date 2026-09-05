import { getSupabaseAdminClient } from '@/lib/supabase/admin';
import { executeHotWalletWithdrawal } from '@/lib/wallets/evmWithdrawal';

export class P2PEscrowService {
  /**
   * Lock seller funds into trade escrow atomically
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
   * Release escrow crypto directly to buyer's address via Hot Wallet
   */
  static async releaseTradeEscrow(tradeId: string, sellerUserId: string) {
    const supabase = getSupabaseAdminClient();

    // 1. Retrieve trade and buyer wallet details
    let { data: trade, error: tradeErr } = await supabase
      .from('p2p_trades')
      .select('*, buyer_wallets:buyer_id(evm_address)')
      .eq('id', tradeId)
      .eq('seller_id', sellerUserId)
      .single();

    if (tradeErr || !trade) {
      const fallback = await supabase
        .from('p2p_trades')
        .select('*')
        .eq('id', tradeId)
        .eq('seller_id', sellerUserId)
        .single();

      if (fallback.error || !fallback.data) {
        throw new Error('Trade record not found or unauthorized seller action');
      }
      trade = fallback.data as any;
    }

    if (trade.status !== 'PAYMENT_MARKED') {
      throw new Error(`Cannot release escrow while trade is in status: ${trade.status}`);
    }

    let recipientAddress: string | undefined = (trade as any).buyer_wallets?.evm_address;

    if (!recipientAddress) {
      const { data: depAddr } = await supabase
        .from('deposit_addresses')
        .select('address')
        .eq('user_id', trade.buyer_id)
        .limit(1)
        .maybeSingle();

      recipientAddress = depAddr?.address;
    }

    if (!recipientAddress) {
      const { data: userAddr } = await supabase
        .from('user_deposit_addresses')
        .select('address')
        .eq('user_id', trade.buyer_id)
        .limit(1)
        .maybeSingle();

      recipientAddress = userAddr?.address;
    }

    if (!recipientAddress) {
      const { data: userWal } = await supabase
        .from('user_wallets')
        .select('deposit_address')
        .eq('user_id', trade.buyer_id)
        .limit(1)
        .maybeSingle();

      recipientAddress = userWal?.deposit_address;
    }

    if (!recipientAddress || recipientAddress === 'PENDING_GENERATION') {
      throw new Error('Buyer does not have a valid EVM wallet address linked');
    }

    const tokenContract = process.env.USDT_CONTRACT_ADDRESS!;
    const cryptoAmount = ((trade as any).crypto_amount ?? (trade as any).amount).toString();

    // 2. Broadcast transfer directly from Hot Wallet
    const txHash = await executeHotWalletWithdrawal(
      recipientAddress,
      cryptoAmount,
      tokenContract
    );

    // 3. Mark trade completed and attach on-chain transaction hash
    await supabase
      .from('p2p_trades')
      .update({
        status: 'COMPLETED',
        release_tx_hash: txHash,
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId);

    return { success: true, txHash };
  }
}
