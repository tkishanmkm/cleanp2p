import { supabase } from './client';

export interface TradeMessageRecord {
  id: string;
  trade_id: string;
  sender_id: string;
  message: string;
  attachment_url?: string | null;
  created_at: string;
}

export interface SendMessageResponse {
  data: TradeMessageRecord | null;
  error: Error | null;
}

export interface GetMessagesResponse {
  data: TradeMessageRecord[] | null;
  error: Error | null;
}

/**
 * Inserts a new P2P trade chat message into Supabase.
 */
export async function sendTradeMessage(
  tradeId: string,
  senderId: string,
  message: string,
  attachmentUrl?: string | null
): Promise<SendMessageResponse> {
  try {
    const { data, error } = await supabase
      .from('trade_messages')
      .insert({
        trade_id: tradeId,
        sender_id: senderId,
        message,
        attachment_url: attachmentUrl || null,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches historical trade chat messages ordered chronologically by created_at.
 */
export async function getTradeMessages(tradeId: string): Promise<GetMessagesResponse> {
  try {
    const { data, error } = await supabase
      .from('trade_messages')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Sets up a real-time subscription for new P2P trade chat messages.
 * Uses supabase.channel('trade_chat:' + tradeId) with postgres_changes for INSERT events.
 * 
 * @param tradeId The ID of the active trade
 * @param onMessage Callback invoked whenever a new message is received
 * @returns Cleanup function to unsubscribe from the real-time channel
 */
export function subscribeToTradeMessages(
  tradeId: string,
  onMessage: (message: TradeMessageRecord) => void
): () => void {
  const channelName = `trade_chat:${tradeId}`;

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trade_messages',
        filter: `trade_id=eq.${tradeId}`,
      },
      (payload) => {
        if (payload.new) {
          onMessage(payload.new as TradeMessageRecord);
        }
      }
    )
    .subscribe();

  // Return unsubscribe cleanup function
  return () => {
    supabase.removeChannel(channel);
  };
}
