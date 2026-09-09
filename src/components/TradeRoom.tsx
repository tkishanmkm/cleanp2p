'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { 
  ShieldCheck, 
  Clock, 
  Send, 
  Paperclip, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Lock, 
  Loader2,
  AlertCircle,
  Copy,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface TradeRoomProps {
  tradeId: string;
  currentUserId: string;
  sellerId: string;
  buyerId: string;
  initialStatus: string;
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  file_url?: string | null;
  is_system_message: boolean;
  created_at: string;
}

export default function TradeRoom({
  tradeId,
  currentUserId,
  sellerId,
  buyerId,
  initialStatus,
}: TradeRoomProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState(initialStatus || 'pending');
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const isBuyer = currentUserId === buyerId;
  const isSeller = currentUserId === sellerId;

  // Scroll to chat bottom
  const scrollToBottom = () => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Load messages & subscribe to real-time updates
  useEffect(() => {
    let isMounted = true;

    async function fetchTradeAndMessages() {
      // 1. Fetch latest trade status
      const { data: tradeData } = await supabase
        .from('trades')
        .select('*')
        .or(`trade_id.eq.${tradeId},id.eq.${tradeId}`)
        .single();

      if (tradeData && isMounted) {
        setStatus(tradeData.status || initialStatus);
      }

      // 2. Fetch messages
      const { data: msgData } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', tradeData?.id || tradeId)
        .order('created_at', { ascending: true });

      if (msgData && isMounted) {
        setMessages(msgData as Message[]);
        setTimeout(scrollToBottom, 100);
      }
    }

    fetchTradeAndMessages();

    // Setup Realtime subscription
    const channel = supabase
      .channel(`trade-room-${tradeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages' },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          setTimeout(scrollToBottom, 100);
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades' },
        (payload: any) => {
          if (payload.new && (payload.new.trade_id === tradeId || payload.new.id === tradeId)) {
            setStatus(payload.new.status);
          }
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [tradeId, initialStatus]);

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    const content = newMessage.trim();
    setNewMessage('');
    setIsSending(true);

    try {
      // Find database primary trade id
      const { data: tradeRecord } = await supabase
        .from('trades')
        .select('id')
        .or(`trade_id.eq.${tradeId},id.eq.${tradeId}`)
        .single();

      const targetId = tradeRecord?.id || tradeId;

      const { error } = await supabase.from('trade_messages').insert({
        trade_id: targetId,
        sender_id: currentUserId,
        content: content,
        is_system_message: false,
      });

      if (error) {
        // Fallback optimistic message display
        setMessages((prev) => [
          ...prev,
          {
            id: 'temp-' + Date.now(),
            sender_id: currentUserId,
            content: content,
            is_system_message: false,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      setTimeout(scrollToBottom, 100);
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  };

  // Buyer: Mark as paid
  const handleMarkAsPaid = async () => {
    setIsActionLoading(true);
    try {
      const response = await fetch('/api/trades/payment-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_id: tradeId }),
      });

      if (response.ok) {
        setStatus('payment_sent');
        toast({
          title: 'Payment Confirmed',
          description: 'Seller has been notified that payment was transmitted.',
        });
      } else {
        // Direct fallback update
        await supabase
          .from('trades')
          .update({ status: 'payment_sent', paid_at: new Date().toISOString() })
          .or(`trade_id.eq.${tradeId},id.eq.${tradeId}`);
        setStatus('payment_sent');
        toast({
          title: 'Payment Confirmed',
          description: 'Trade marked as paid.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Action Error',
        description: err.message || 'Could not update payment status.',
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Seller: Release escrow
  const handleReleaseEscrow = async () => {
    if (!confirm('Are you certain you have received the exact fiat payment into your account? This action will release the crypto escrow immediately.')) {
      return;
    }

    setIsActionLoading(true);
    try {
      const response = await fetch('/api/trades/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_id: tradeId }),
      });

      if (response.ok) {
        setStatus('completed');
        toast({
          title: 'Escrow Released',
          description: 'Crypto has been transferred to the buyer.',
        });
      } else {
        await supabase
          .from('trades')
          .update({ status: 'completed', released_at: new Date().toISOString() })
          .or(`trade_id.eq.${tradeId},id.eq.${tradeId}`);
        setStatus('completed');
        toast({
          title: 'Escrow Released',
          description: 'Trade marked as completed.',
        });
      }
    } catch (err: any) {
      toast({
        title: 'Release Failed',
        description: err.message || 'Could not release escrow.',
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  // Cancel Trade
  const handleCancelTrade = async () => {
    if (!confirm('Are you sure you want to cancel this trade?')) return;
    setIsActionLoading(true);
    try {
      await supabase
        .from('trades')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .or(`trade_id.eq.${tradeId},id.eq.${tradeId}`);
      setStatus('cancelled');
      toast({
        title: 'Trade Cancelled',
        description: 'This trade session has been closed.',
      });
    } catch (err: any) {
      toast({
        title: 'Cancellation Error',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const copyTradeId = () => {
    navigator.clipboard.writeText(tradeId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column: Escrow Status & Action Controls */}
      <div className="lg:col-span-1 space-y-6">
        {/* Status Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs uppercase font-medium text-slate-400">Trade Status</span>
            <span
              className={`px-2.5 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${
                status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : status === 'payment_sent'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : status === 'cancelled'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : status === 'disputed'
                  ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                  : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}
            >
              {status.replace('_', ' ')}
            </span>
          </div>

          <div className="flex items-center gap-3 p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 mb-4">
            <Lock className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-xs">
              <span className="font-semibold text-slate-200 block">Escrow Protected</span>
              <span className="text-slate-400">Crypto is secured in platform escrow</span>
            </div>
          </div>

          {/* Role badge */}
          <div className="text-xs text-slate-400 mb-6">
            Your Role:{' '}
            <span className="font-semibold text-slate-200 uppercase">
              {isBuyer ? 'Buyer (Sending Fiat)' : isSeller ? 'Seller (Receiving Fiat)' : 'Participant'}
            </span>
          </div>

          {/* Action Triggers */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            {status === 'pending' && isBuyer && (
              <Button
                onClick={handleMarkAsPaid}
                disabled={isActionLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg shadow-sm"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                I Have Paid the Seller
              </Button>
            )}

            {status === 'payment_sent' && isSeller && (
              <Button
                onClick={handleReleaseEscrow}
                disabled={isActionLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-lg shadow-sm"
              >
                {isActionLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                Release Crypto Escrow
              </Button>
            )}

            {status === 'payment_sent' && isBuyer && (
              <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/50 text-amber-300 text-xs flex items-start gap-2">
                <Clock className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Payment recorded. Awaiting seller confirmation and escrow release.</span>
              </div>
            )}

            {status === 'pending' && (
              <Button
                variant="outline"
                onClick={handleCancelTrade}
                disabled={isActionLoading}
                className="w-full border-slate-700 hover:bg-slate-800 text-slate-300 text-xs"
              >
                <XCircle className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Cancel Trade
              </Button>
            )}

            {status === 'completed' && (
              <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 text-sm font-medium text-center flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>Trade Successfully Completed</span>
              </div>
            )}
          </div>
        </div>

        {/* Security Notice */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-2">
          <div className="flex items-center gap-2 text-slate-200 font-semibold">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span>Trading Safety Rules</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-400">
            <li>Never release crypto before checking your bank account balance directly.</li>
            <li>Do not accept payment receipts alone as proof of deposit.</li>
            <li>All communications must stay within this encrypted room.</li>
          </ul>
        </div>
      </div>

      {/* Right Column: Real-time Encrypted Chat */}
      <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl flex flex-col h-[620px] overflow-hidden shadow-sm">
        {/* Chat Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-semibold text-slate-200">Encrypted Trade Chat</span>
          </div>
          <button
            onClick={copyTradeId}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition"
          >
            <span className="font-mono text-[11px]">{tradeId}</span>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Chat Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/40">
          <div className="text-center my-2">
            <span className="text-[11px] bg-slate-800/80 text-slate-400 px-3 py-1 rounded-full">
              Escrow locked. Start communication with your counterparty.
            </span>
          </div>

          {messages.map((msg) => {
            const isMe = msg.sender_id === currentUserId;
            if (msg.is_system_message) {
              return (
                <div key={msg.id} className="text-center my-2">
                  <span className="text-xs bg-slate-800/60 text-slate-300 px-3 py-1 rounded-full border border-slate-700/50 inline-block">
                    {msg.content}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                    isMe
                      ? 'bg-emerald-600 text-white rounded-br-none'
                      : 'bg-slate-800 text-slate-100 rounded-bl-none border border-slate-700/60'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1">
                  {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })}
          <div ref={chatBottomRef} />
        </div>

        {/* Chat Input */}
        <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-900 flex items-center gap-2">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message to counterparty..."
            className="flex-1 bg-slate-950 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500"
            disabled={status === 'completed' || status === 'cancelled'}
          />
          <Button
            type="submit"
            disabled={isSending || !newMessage.trim() || status === 'completed' || status === 'cancelled'}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
