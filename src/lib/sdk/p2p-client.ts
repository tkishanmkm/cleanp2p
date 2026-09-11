import { createClient } from '@/lib/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface ReleaseEscrowParams {
  tradeId: string;
  totpCode?: string;
}

export interface ReleaseEscrowResult {
  success: boolean;
  trade_id?: string;
  credited_amount?: number;
  fee_deducted?: number;
  message?: string;
  error?: string;
}

export interface TradeChatMessage {
  id: string;
  trade_id?: string;
  order_id?: string;
  sender_id: string | null;
  message: string;
  message_type?: 'TEXT' | 'SYSTEM' | 'IMAGE' | 'MODERATOR';
  created_at: string;
  [key: string]: any;
}

export interface TradeStateChange {
  id: string;
  status: 'INITIATED' | 'PAID' | 'RELEASED' | 'DISPUTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  buyer_id: string;
  seller_id: string;
  crypto_amount: number;
  crypto_symbol: string;
  updated_at: string;
  [key: string]: any;
}

/**
 * 1. Triggers Atomic Escrow Settlement RPC for an active P2P trade.
 * Enforces PostgreSQL FOR UPDATE row locking and 2FA TOTP verification where applicable.
 */
export async function confirmAndReleaseEscrow({
  tradeId,
  totpCode,
}: ReleaseEscrowParams): Promise<ReleaseEscrowResult> {
  const supabase = createClient();

  try {
    // Check if optional 2FA verification header is required
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (totpCode) {
      headers['x-totp-code'] = totpCode;
    }

    // Call dedicated server action / API route which wraps the atomic PostgreSQL RPC
    const response = await fetch(`/api/p2p/trades/${tradeId}/release`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tradeId, totpCode }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || result.message || 'Failed to release escrow');
    }

    return {
      success: true,
      trade_id: result.trade_id || tradeId,
      credited_amount: result.credited_amount,
      fee_deducted: result.fee_deducted,
      message: result.message,
    };
  } catch (err: any) {
    console.error('[Escrow Release Error]:', err.message || err);
    return {
      success: false,
      error: err.message || 'Escrow release failed',
    };
  }
}

/**
 * 2. Direct RPC Client invocation helper (Alternative direct-to-database method)
 */
export async function releaseP2PEscrowDirect(
  tradeId: string,
  sellerId: string,
  buyerId: string,
  amount: number,
  asset: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc('release_p2p_escrow', {
    p_trade_id: tradeId,
    p_seller_id: sellerId,
    p_buyer_id: buyerId,
    p_amount: amount,
    p_asset: asset,
  });

  if (error) {
    console.error('[Direct RPC Error]:', error.message);
    return { success: false, error: error.message };
  }

  return { success: true, data };
}

/**
 * 3. Subscribes to live realtime chat messages for an active trade / order.
 */
export function subscribeToOrderChat(
  orderIdOrTradeId: string,
  onMessageReceived: (msg: TradeChatMessage) => void
): RealtimeChannel {
  const supabase = createClient();

  return supabase
    .channel(`order_chat_${orderIdOrTradeId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trade_messages',
        filter: `trade_id=eq.${orderIdOrTradeId}`,
      },
      (payload) => {
        if (payload?.new) {
          onMessageReceived(payload.new as TradeChatMessage);
        }
      }
    )
    .subscribe();
}

/**
 * 4. Subscribes to real-time state machine updates on the active trade (PAID, RELEASED, DISPUTED, etc.).
 */
export function subscribeToTradeState(
  tradeId: string,
  onStateUpdate: (updatedTrade: TradeStateChange) => void
): RealtimeChannel {
  const supabase = createClient();

  return supabase
    .channel(`trade_state_${tradeId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'trades',
        filter: `id=eq.${tradeId}`,
      },
      (payload) => {
        if (payload?.new) {
          onStateUpdate(payload.new as TradeStateChange);
        }
      }
    )
    .subscribe();
}
