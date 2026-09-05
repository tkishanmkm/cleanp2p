import { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export class TradeRealtimeService {
  private channel: RealtimeChannel | null = null;

  constructor(
    private supabase: SupabaseClient,
    private tradeId: string,
    private userId: string
  ) {}

  public subscribeToTrade(
    onTradeUpdate: (payload: any) => void,
    onChatMessage: (payload: any) => void
  ) {
    this.channel = this.supabase
      .channel(`trade-room:${this.tradeId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'p2p_trades',
          filter: `id=eq.${this.tradeId}`,
        },
        (payload) => {
          onTradeUpdate(payload.new);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'p2p_chat_messages',
          filter: `trade_id=eq.${this.tradeId}`,
        },
        (payload) => {
          onChatMessage(payload.new);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`Connected to trade channel: ${this.tradeId}`);
        }
      });
  }

  public async sendChatMessage(message: string): Promise<boolean> {
    if (!message || message.trim().length === 0) return false;

    const { error } = await this.supabase.from('p2p_chat_messages').insert({
      trade_id: this.tradeId,
      sender_id: this.userId,
      message: message.trim(),
    });

    return !error;
  }

  public unsubscribe() {
    if (this.channel) {
      this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
