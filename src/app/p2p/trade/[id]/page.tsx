'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

export default function TradePage() {
  const params = useParams();
  const orderId = Array.isArray(params.id) ? params.id[0] : (params.id as string);
  const [supabase] = useState(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';
    return createBrowserClient(url, key);
  });

  const [order, setOrder] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    async function initTrade() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) setCurrentUserId(user.id);

      // 1. Fetch Order details
      const { data: orderData } = await supabase
        .from('p2p_orders')
        .select('*')
        .eq('id', orderId)
        .single();
      if (orderData) setOrder(orderData);

      // 2. Fetch existing chat messages
      const { data: initialMsgs } = await supabase
        .from('p2p_chat_messages')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (initialMsgs) setMessages(initialMsgs);

      // 3. Subscribe to Realtime messages
      const channel = supabase
        .channel(`order-${orderId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'p2p_chat_messages', filter: `order_id=eq.${orderId}` },
          (payload) => {
            setMessages((prev) => [...prev, payload.new]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }

    initTrade();
  }, [orderId, supabase]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !currentUserId) return;

    await supabase.from('p2p_chat_messages').insert({
      order_id: orderId,
      sender_id: currentUserId,
      message: newMessage.trim(),
    });

    setNewMessage('');
  };

  const handleUpdateStatus = async (newStatus: string) => {
    setStatusText('Updating order state...');
    try {
      const res = await fetch(`/api/p2p/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setOrder(data.order);
        setStatusText(`Order marked as ${newStatus}`);
      } else {
        setStatusText(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setStatusText(`Error: ${err.message}`);
    }
  };

  if (!order) return <div className="p-8">Loading P2P Trade session...</div>;

  const isBuyer = currentUserId === order.buyer_id;
  const isSeller = currentUserId === order.seller_id;

  return (
    <div className="max-w-5xl mx-auto p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Trade Details & Controls */}
      <div className="md:col-span-2 space-y-6">
        <div className="p-6 border rounded-xl bg-card space-y-4">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold">Trade #{orderId.slice(0, 8)}</h1>
            <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-semibold">
              {order.status}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Amount to Pay</p>
              <p className="text-lg font-bold">{order.fiat_amount} {order.fiat_currency}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Crypto in Escrow</p>
              <p className="text-lg font-bold">{order.crypto_amount} USDT</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t flex gap-3">
            {isBuyer && order.status === 'PENDING' && (
              <button
                onClick={() => handleUpdateStatus('PAID')}
                className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium"
              >
                I Have Transferred Payment
              </button>
            )}

            {isSeller && order.status === 'PAID' && (
              <button
                onClick={() => handleUpdateStatus('COMPLETED')}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium"
              >
                Release Crypto to Buyer
              </button>
            )}
          </div>
          {statusText && <p className="text-xs text-muted-foreground mt-2">{statusText}</p>}
        </div>
      </div>

      {/* Real-time Trade Chat */}
      <div className="p-4 border rounded-xl bg-card flex flex-col h-[500px]">
        <h2 className="text-md font-semibold mb-3 border-b pb-2">Trade Chat</h2>
        <div className="flex-1 overflow-y-auto space-y-3 p-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-2.5 rounded-lg text-xs max-w-[80%] ${
                m.sender_id === currentUserId
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {m.message}
            </div>
          ))}
        </div>

        <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="Type payment instructions or status..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1 p-2 border rounded text-xs"
          />
          <button type="submit" className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
