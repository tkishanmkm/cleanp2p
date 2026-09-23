import { InitiateTradePayload } from './types';
import { createClient } from '@/lib/supabase';

export async function initiateTrade(payload: InitiateTradePayload): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const token = session?.access_token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/trades/initiate', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to initiate trade.');
  }

  const tradeId = data?.tradeId || data?.id || data?.trade_id;
  if (!tradeId) {
    throw new Error('Invalid trade initiation response from server.');
  }

  return tradeId;
}
