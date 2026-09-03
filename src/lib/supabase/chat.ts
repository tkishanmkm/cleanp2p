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

const isUuid = (val: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

/**
 * Inserts a new P2P trade chat message into Supabase.
 * Syncs to both trade_chat_messages and trade_messages to guarantee real-time delivery.
 */
export async function sendTradeMessage(
  tradeId: string,
  senderId: string,
  message: string,
  attachmentUrl?: string | null
): Promise<SendMessageResponse> {
  const now = new Date().toISOString();
  let primaryRecord: TradeMessageRecord | null = null;
  let primaryError: Error | null = null;

  // 1. Insert into trade_chat_messages if UUIDs are valid
  if (isUuid(tradeId) && isUuid(senderId)) {
    try {
      const { data: chatData, error: chatError } = await supabase
        .from('trade_chat_messages')
        .insert({
          trade_id: tradeId,
          sender_id: senderId,
          message,
          created_at: now,
        })
        .select()
        .single();

      if (!chatError && chatData) {
        primaryRecord = {
          id: chatData.id,
          trade_id: chatData.trade_id,
          sender_id: chatData.sender_id,
          message: chatData.message,
          attachment_url: attachmentUrl || null,
          created_at: chatData.created_at,
        };
      }
    } catch {
      // Non-fatal if table RLS or network falls back to trade_messages
    }
  }

  // 2. Also insert into trade_messages for backwards compatibility and attachment support
  try {
    const { data, error } = await supabase
      .from('trade_messages')
      .insert({
        trade_id: tradeId,
        sender_id: senderId,
        message,
        attachment_url: attachmentUrl || null,
        created_at: now,
      })
      .select()
      .single();

    if (error && !primaryRecord) {
      primaryError = new Error(error.message);
    } else if (data && !primaryRecord) {
      primaryRecord = data;
    }
  } catch (err: unknown) {
    if (!primaryRecord) {
      primaryError = err instanceof Error ? err : new Error(String(err));
    }
  }

  return { data: primaryRecord, error: primaryError };
}

/**
 * Fetches historical trade chat messages ordered chronologically by created_at.
 * Merges messages from trade_chat_messages and trade_messages without duplicates.
 */
export async function getTradeMessages(tradeId: string): Promise<GetMessagesResponse> {
  try {
    const recordsMap = new Map<string, TradeMessageRecord>();

    // Fetch from trade_messages
    const { data: tmData } = await supabase
      .from('trade_messages')
      .select('*')
      .eq('trade_id', tradeId)
      .order('created_at', { ascending: true });

    if (tmData) {
      for (const m of tmData) {
        recordsMap.set(m.id, m);
      }
    }

    // Fetch from trade_chat_messages if tradeId is a valid UUID
    if (isUuid(tradeId)) {
      const { data: tcmData } = await supabase
        .from('trade_chat_messages')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });

      if (tcmData) {
        for (const m of tcmData) {
          if (!recordsMap.has(m.id)) {
            recordsMap.set(m.id, {
              id: m.id,
              trade_id: m.trade_id,
              sender_id: m.sender_id,
              message: m.message,
              attachment_url: null,
              created_at: m.created_at,
            });
          }
        }
      }
    }

    const merged = Array.from(recordsMap.values()).sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    return { data: merged, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Sets up a real-time subscription for new P2P trade chat messages.
 * Listens to new messages on trade_chat_messages and trade_messages for the specific trade.
 * 
 * @param tradeId The ID of the active trade
 * @param onMessage Callback invoked whenever a new message is received
 * @returns Cleanup function to unsubscribe from the real-time channel
 */
export function subscribeToTradeMessages(
  tradeId: string,
  onMessage: (message: TradeMessageRecord) => void
): () => void {
  const seenIds = new Set<string>();

  const handleNewRecord = (payloadNew: any) => {
    if (!payloadNew?.id || seenIds.has(payloadNew.id)) return;
    seenIds.add(payloadNew.id);
    onMessage({
      id: payloadNew.id,
      trade_id: payloadNew.trade_id,
      sender_id: payloadNew.sender_id,
      message: payloadNew.message,
      attachment_url: payloadNew.attachment_url || null,
      created_at: payloadNew.created_at,
    });
  };

  const channel = supabase
    .channel(`trade-chat-room-${tradeId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trade_chat_messages',
        filter: `trade_id=eq.${tradeId}`,
      },
      (payload) => {
        console.log('New chat message (trade_chat_messages):', payload.new);
        handleNewRecord(payload.new);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'trade_messages',
        filter: `trade_id=eq.${tradeId}`,
      },
      (payload) => {
        console.log('New chat message (trade_messages):', payload.new);
        handleNewRecord(payload.new);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Convenience export matching standard trade chat room subscription
 */
export function subscribeToTradeChat(
  tradeId: string,
  onMessage: (message: TradeMessageRecord) => void
): () => void {
  return subscribeToTradeMessages(tradeId, onMessage);
}

/**
 * Sets up a real-time subscription for live status changes on trades.
 * 
 * @param tradeId Optional trade ID to filter updates for a specific trade
 * @param onUpdate Callback invoked whenever a trade status changes
 * @returns Cleanup function to unsubscribe
 */
export function subscribeToTradeStatusUpdates(
  tradeId?: string,
  onUpdate?: (trade: any) => void
): () => void {
  const channelName = tradeId ? `trade-status-updates-${tradeId}` : 'trade-status-updates';
  const filter = tradeId ? `id=eq.${tradeId}` : undefined;

  const tradeChannel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'trades',
        ...(filter ? { filter } : {}),
      },
      (payload) => {
        console.log('Trade status changed:', payload.new);
        if (onUpdate && payload.new) {
          onUpdate(payload.new);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(tradeChannel);
  };
}

