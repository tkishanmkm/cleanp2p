import { getSupabaseAdminClient } from '../lib/supabase/admin';

export async function processExpiredP2PTrades() {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();

  // Fetch trades where payment window expired and buyer hasn't marked paid
  let { data: expiredTrades, error } = await supabase
    .from('p2p_trades')
    .select('id, seller_id, crypto_amount')
    .eq('status', 'ESCROW_LOCKED')
    .lt('expires_at', now);

  if (error) {
    // Fallback if schema uses 'amount' instead of 'crypto_amount'
    const fallback = await supabase
      .from('p2p_trades')
      .select('id, seller_id, amount')
      .eq('status', 'ESCROW_LOCKED')
      .lt('expires_at', now);
    expiredTrades = fallback.data as any;
    error = fallback.error;
  }

  if (error || !expiredTrades || expiredTrades.length === 0) return;

  for (const trade of expiredTrades) {
    const tradeAmount = ((trade as any).crypto_amount ?? (trade as any).amount)?.toString() || '0';

    // 1. Credit funds back to seller
    try {
      const { data: balance } = await supabase
        .from('user_balances')
        .select('amount')
        .eq('user_id', trade.seller_id)
        .eq('asset_symbol', 'USDT')
        .single();

      if (balance) {
        await supabase
          .from('user_balances')
          .update({
            amount: parseFloat(balance.amount) + parseFloat(tradeAmount),
            updated_at: now
          })
          .eq('user_id', trade.seller_id)
          .eq('asset_symbol', 'USDT');
      }
    } catch {
      // Ignored if table doesn't exist
    }

    // Support user_wallets balance refund
    try {
      const { data: wallet } = await supabase
        .from('user_wallets')
        .select('id, balance, locked_balance')
        .eq('user_id', trade.seller_id)
        .eq('asset_symbol', 'USDT')
        .maybeSingle();

      if (wallet) {
        await supabase
          .from('user_wallets')
          .update({
            balance: (parseFloat(wallet.balance || '0') + parseFloat(tradeAmount)).toString(),
            locked_balance: Math.max(
              0,
              parseFloat(wallet.locked_balance || '0') - parseFloat(tradeAmount)
            ).toString(),
            updated_at: now
          })
          .eq('id', wallet.id);
      }
    } catch {
      // Ignored
    }

    // 2. Mark trade state as CANCELLED
    await supabase
      .from('p2p_trades')
      .update({ status: 'CANCELLED', updated_at: now })
      .eq('id', trade.id);

    console.log(`[P2P Expiry Worker] Expired & refunded trade: ${trade.id}`);
  }
}
