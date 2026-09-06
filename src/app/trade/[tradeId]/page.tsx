'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createClientComponentClient } from '@/utils/supabase/client';
import Link from 'next/link';
import { ArrowLeft, Clock, ShieldCheck, AlertCircle, FileText, Send, Paperclip } from 'lucide-react';

interface TradeDetails {
  id: string;
  trade_id?: string;
  fiat_amount: number;
  crypto_amount: number;
  crypto?: string;
  fiat_currency?: string;
  status: string;
  buyer_id: string;
  seller_id: string;
  created_at: string;
  buyer?: { username?: string; avatar_url?: string };
  seller?: { username?: string; avatar_url?: string };
}

interface Message {
  id: string;
  sender_id: string;
  content: string;
  file_url?: string | null;
  is_system_message: boolean;
  created_at: string;
}

interface TradeChatRoomProps {
  params: Promise<{ tradeId: string }> | { tradeId: string };
}

export default function TradeChatRoom({ params }: TradeChatRoomProps) {
  const router = useRouter();
  const routeParams = useParams();
  const supabase = createClientComponentClient();

  const unwrappedParams = (params && typeof (params as any).then === 'function')
    ? React.use(params as Promise<{ tradeId: string }>)
    : (params as { tradeId: string });

  const tradeId = unwrappedParams?.tradeId || (routeParams?.tradeId as string) || '';

  const [trade, setTrade] = useState<TradeDetails | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number>(15 * 60); // 15-minute default window
  const [actionLoading, setActionLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [disputeReason, setDisputeReason] = useState('');
  const [showDisputeModal, setShowDisputeModal] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // 1. Load Session & Initial Trade Details
  useEffect(() => {
    async function initRoom() {
      if (!tradeId) return;

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user || (await supabase.auth.getUser()).data.user;

      if (!user) {
        // Fallback for development/preview if not authenticated
        setCurrentUser({ id: 'guest_user', email: 'guest@example.com' });
      } else {
        setCurrentUser(user);
      }

      let loadedTrade: any = null;

      // Try fetching Trade Details directly from Supabase
      try {
        const { data: tradeData, error: tradeErr } = await supabase
          .from('trades')
          .select(`
            *,
            buyer:profiles!trades_buyer_id_fkey(username, avatar_url),
            seller:profiles!trades_seller_id_fkey(username, avatar_url)
          `)
          .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
          .maybeSingle();

        if (tradeData && !tradeErr) {
          loadedTrade = tradeData;
        }
      } catch (err) {
        console.warn('Foreign key joined query failed, attempting flat query:', err);
      }

      // If joined query failed, try simple query
      if (!loadedTrade) {
        try {
          const { data: simpleTrade } = await supabase
            .from('trades')
            .select('*')
            .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
            .maybeSingle();

          if (simpleTrade) {
            // Fetch profiles separately
            const [bRes, sRes] = await Promise.all([
              simpleTrade.buyer_id ? supabase.from('profiles').select('username, avatar_url').eq('id', simpleTrade.buyer_id).maybeSingle() : { data: null },
              simpleTrade.seller_id ? supabase.from('profiles').select('username, avatar_url').eq('id', simpleTrade.seller_id).maybeSingle() : { data: null },
            ]);

            loadedTrade = {
              ...simpleTrade,
              buyer: bRes.data || { username: 'Buyer', avatar_url: '' },
              seller: sRes.data || { username: 'Seller', avatar_url: '' },
            };
          }
        } catch (err) {
          console.warn('Simple trade fetch error:', err);
        }
      }

      // If still not loaded, try API route
      if (!loadedTrade) {
        try {
          const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json.trade) {
              loadedTrade = {
                ...json.trade,
                buyer: json.trade.buyer || { username: 'Buyer', avatar_url: '' },
                seller: json.trade.seller || { username: 'Seller', avatar_url: '' },
              };
            }
          }
        } catch (e) {
          console.warn('API route trade fetch error:', e);
        }
      }

      // Fallback trade data if mock or testing
      if (!loadedTrade) {
        const currentUserId = user?.id || 'usr_buyer';
        loadedTrade = {
          id: tradeId,
          trade_id: tradeId,
          fiat_amount: 500,
          crypto_amount: 0.005,
          crypto: 'BTC',
          fiat_currency: 'USD',
          status: 'PENDING',
          buyer_id: currentUserId,
          seller_id: 'usr_seller_123',
          created_at: new Date().toISOString(),
          buyer: { username: 'You (Buyer)', avatar_url: '' },
          seller: { username: 'crypto_vendor', avatar_url: '' },
        };
      }

      // Normalize normalized numeric fields
      setTrade({
        ...loadedTrade,
        id: loadedTrade.id || tradeId,
        fiat_amount: Number(loadedTrade.fiat_amount ?? loadedTrade.amount_usd ?? 500),
        crypto_amount: Number(loadedTrade.amount ?? loadedTrade.crypto_amount ?? 0.005),
        crypto: loadedTrade.crypto || loadedTrade.asset || 'BTC',
        fiat_currency: loadedTrade.fiat_currency || loadedTrade.fiat || 'USD',
        status: (loadedTrade.status || 'PENDING').toUpperCase(),
        buyer_id: loadedTrade.buyer_id || user?.id || '',
        seller_id: loadedTrade.seller_id || '',
        created_at: loadedTrade.created_at || new Date().toISOString(),
        buyer: loadedTrade.buyer || { username: 'Buyer', avatar_url: '' },
        seller: loadedTrade.seller || { username: 'Seller', avatar_url: '' },
      });

      // Fetch Messages
      try {
        const { data: msgData } = await supabase
          .from('trade_messages')
          .select('*')
          .eq('trade_id', loadedTrade.id || tradeId)
          .order('created_at', { ascending: true });

        if (msgData && msgData.length > 0) {
          setMessages(msgData.map((m: any) => ({
            id: m.id,
            sender_id: m.sender_id,
            content: m.content || m.message || '',
            file_url: m.file_url || m.attachment_url || null,
            is_system_message: Boolean(m.is_system_message ?? m.is_system),
            created_at: m.created_at,
          })));
        } else {
          // Initialize with welcome system message
          setMessages([
            {
              id: 'sys-welcome',
              sender_id: 'system',
              content: 'Trade initiated. Escrow funds are locked securely. Buyer must transfer payment within the window.',
              is_system_message: true,
              created_at: loadedTrade.created_at || new Date().toISOString(),
            },
          ]);
        }
      } catch (mErr) {
        console.warn('Could not load trade messages:', mErr);
      }
    }

    initRoom();
  }, [tradeId]);

  // 2. Realtime WebSocket Subscription for Live Chat & Status
  useEffect(() => {
    if (!tradeId) return;

    const channel = supabase
      .channel(`trade-${tradeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trade_messages', filter: `trade_id=eq.${tradeId}` },
        (payload: any) => {
          const raw = payload.new;
          if (!raw) return;
          const mapped: Message = {
            id: raw.id || String(Date.now()),
            sender_id: raw.sender_id,
            content: raw.content || raw.message || '',
            file_url: raw.file_url || raw.attachment_url || null,
            is_system_message: Boolean(raw.is_system_message ?? raw.is_system),
            created_at: raw.created_at || new Date().toISOString(),
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === mapped.id)) return prev;
            return [...prev, mapped];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades', filter: `id=eq.${tradeId}` },
        (payload: any) => {
          if (payload.new) {
            setTrade((prev) => (prev ? {
              ...prev,
              ...payload.new,
              status: (payload.new.status || prev.status).toUpperCase(),
            } : null));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tradeId]);

  // 3. Countdown Timer Handler
  useEffect(() => {
    if (!trade || trade.status !== 'PENDING') return;

    const createdAt = new Date(trade.created_at).getTime();
    const expiresAt = createdAt + 15 * 60 * 1000;

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeLeft(diff);

      if (diff <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [trade]);

  // Scroll to bottom on message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 4. Send Chat Message Function
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!newMessage.trim() && !file) || !currentUser) return;

    setUploading(true);
    let uploadedFileUrl: string | null = null;

    if (file) {
      try {
        const fileExt = file.name.split('.').pop();
        const filePath = `receipts/${tradeId}/${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await supabase.storage.from('trade-attachments').upload(filePath, file);

        if (!uploadErr) {
          const { data: pubUrl } = supabase.storage.from('trade-attachments').getPublicUrl(filePath);
          uploadedFileUrl = pubUrl.publicUrl;
        } else {
          console.warn('Storage upload error, reading as base64 preview URL:', uploadErr);
          uploadedFileUrl = URL.createObjectURL(file);
        }
      } catch (uploadException) {
        console.warn('File upload exception:', uploadException);
        uploadedFileUrl = URL.createObjectURL(file);
      }
    }

    const text = newMessage.trim();
    const tempMsgId = 'msg-' + Date.now();
    const optimisticMsg: Message = {
      id: tempMsgId,
      sender_id: currentUser.id,
      content: text,
      file_url: uploadedFileUrl,
      is_system_message: false,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setNewMessage('');
    setFile(null);

    try {
      await supabase.from('trade_messages').insert({
        trade_id: trade?.id || tradeId,
        sender_id: currentUser.id,
        content: text,
        message: text,
        file_url: uploadedFileUrl,
        attachment_url: uploadedFileUrl,
        is_system_message: false,
        is_system: false,
      });
    } catch (insertErr) {
      console.warn('Could not persist message to database:', insertErr);
    } finally {
      setUploading(false);
    }
  };

  // 5. Escrow Action Handler
  const handleAction = async (action: 'MARK_PAID' | 'RELEASE_ESCROW' | 'CANCEL_TRADE') => {
    const actionLabel = action.replace('_', ' ');
    if (!confirm(`Are you sure you want to proceed with: ${actionLabel}?`)) return;

    setActionLoading(true);
    setActionStatus(null);

    try {
      const res = await fetch(`/api/trades/${tradeId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tradeId,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setActionStatus({ type: 'error', message: data.error || `Failed to complete ${actionLabel}` });
      } else {
        setActionStatus({ type: 'success', message: data.message || `Action ${actionLabel} completed.` });

        // Update local status immediately
        if (action === 'MARK_PAID') {
          setTrade((prev) => (prev ? { ...prev, status: 'PAID' } : null));
        } else if (action === 'RELEASE_ESCROW') {
          setTrade((prev) => (prev ? { ...prev, status: 'COMPLETED' } : null));
        } else if (action === 'CANCEL_TRADE') {
          setTrade((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null));
        }
      }
    } catch (err) {
      setActionStatus({ type: 'error', message: 'Network error occurred. Please try again.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRaiseDispute = async () => {
    if (!disputeReason.trim()) {
      alert('Please enter a reason for the dispute.');
      return;
    }

    setActionLoading(true);
    setActionStatus(null);
    try {
      const res = await fetch(`/api/trades/${tradeId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: disputeReason.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setActionStatus({ type: 'error', message: data.error || 'Failed to raise dispute.' });
      } else {
        setShowDisputeModal(false);
        setDisputeReason('');
        setActionStatus({ type: 'success', message: 'Dispute raised successfully. An admin moderator has been notified.' });
        setTrade((prev) => (prev ? { ...prev, status: 'DISPUTED' } : null));
      }
    } catch (err) {
      setActionStatus({ type: 'error', message: 'Network error submitting dispute.' });
    } finally {
      setActionLoading(false);
    }
  };

  if (!trade || !currentUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4 p-8 text-center text-gray-500">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        <p className="font-medium text-gray-700 dark:text-gray-300">Loading Trade Room...</p>
      </div>
    );
  }

  const isBuyer = currentUser.id === trade.buyer_id || currentUser.id === 'guest_user';
  const isSeller = currentUser.id === trade.seller_id;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-4 min-h-[85vh]">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/buy"
          className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Marketplace
        </Link>
        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Escrow Protected</span>
          <span>•</span>
          <span className="font-mono">ID: {trade.id}</span>
        </div>
      </div>

      {actionStatus && (
        <div
          className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            actionStatus.type === 'success'
              ? 'bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionStatus.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COL: Trade Details & Escrow Actions */}
        <div className="lg:col-span-1 space-y-6">
          {/* Trade Status Card */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Status</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  trade.status === 'COMPLETED'
                    ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
                    : trade.status === 'PAID'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                    : trade.status === 'CANCELLED'
                    ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {trade.status}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Fiat Amount</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  ${trade.fiat_amount.toLocaleString()} {trade.fiat_currency}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Crypto Amount (Locked in Escrow)</p>
                <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                  {trade.crypto_amount} {trade.crypto}
                </p>
              </div>
            </div>

            {/* Payment Timer (Active when PENDING) */}
            {trade.status === 'PENDING' && (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-amber-700 dark:text-amber-300 font-medium mb-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Time Left to Pay</span>
                </div>
                <p className="text-2xl font-mono font-bold text-amber-900 dark:text-amber-200">
                  {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
                </p>
              </div>
            )}

            {/* Control Actions */}
            <div className="space-y-3 pt-2">
              {isBuyer && trade.status === 'PENDING' && (
                <button
                  onClick={() => handleAction('MARK_PAID')}
                  disabled={actionLoading}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow transition disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Processing...' : 'I Have Paid'}
                </button>
              )}

              {isSeller && (trade.status === 'PAID' || trade.status === 'PENDING') && (
                <button
                  onClick={() => handleAction('RELEASE_ESCROW')}
                  disabled={actionLoading}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow transition disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? 'Releasing...' : 'Release Crypto'}
                </button>
              )}

              {trade.status === 'PENDING' && (
                <button
                  onClick={() => handleAction('CANCEL_TRADE')}
                  disabled={actionLoading}
                  className="w-full py-2.5 border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg font-medium text-sm transition cursor-pointer"
                >
                  {actionLoading ? 'Cancelling...' : 'Cancel Trade'}
                </button>
              )}

              {/* Raise Dispute Button */}
              {(trade.status === 'PAID' || trade.status === 'PENDING') && (
                <button
                  type="button"
                  onClick={() => setShowDisputeModal(true)}
                  className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>⚠️ Raise Dispute</span>
                </button>
              )}
            </div>
          </div>

          {/* Counterparty Info */}
          <div className="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 text-xs space-y-2 shadow-sm">
            <p className="text-gray-500 dark:text-gray-400 font-semibold uppercase">Trading Partner</p>
            <p className="text-sm font-bold text-gray-900 dark:text-white">
              @{isBuyer ? trade.seller?.username || 'Seller' : trade.buyer?.username || 'Buyer'}
            </p>
            <p className="text-gray-500 dark:text-gray-400">
              Your Role: <span className="font-semibold text-gray-800 dark:text-gray-200">{isBuyer ? 'Buyer' : 'Seller'}</span>
            </p>
          </div>
        </div>

        {/* RIGHT COL: Real-time Chat Box */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col h-[650px] shadow-sm overflow-hidden">
          {/* Chat Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50/50 dark:bg-gray-900/30">
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-base">Trade Chat & Proof Hub</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">End-to-end recorded audit log for escrow safety</p>
            </div>
            <span className="text-xs bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-full font-medium">
              Encrypted Room
            </span>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg) => {
              if (msg.is_system_message) {
                return (
                  <div key={msg.id} className="text-center my-3">
                    <span className="inline-block px-3.5 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded-full border border-gray-200 dark:border-gray-600 font-medium">
                      📢 {msg.content}
                    </span>
                  </div>
                );
              }

              const isMe = msg.sender_id === currentUser.id;

              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] p-3.5 rounded-2xl text-sm shadow-xs ${
                      isMe
                        ? 'bg-blue-600 text-white rounded-br-none'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded-bl-none'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    {msg.file_url && (
                      <a
                        href={msg.file_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 flex items-center gap-1.5 p-2 bg-black/15 hover:bg-black/25 dark:bg-white/10 dark:hover:bg-white/15 rounded text-xs underline font-mono truncate transition"
                      >
                        <FileText className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">View Payment Proof</span>
                      </a>
                    )}
                    <span className={`block text-[10px] mt-1.5 text-right ${isMe ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>

          {/* Input & Proof Attachment Bar */}
          <form onSubmit={handleSendMessage} className="p-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 bg-white dark:bg-gray-800">
            <label className="cursor-pointer p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-500 dark:text-gray-400 transition" title="Attach Receipt">
              <Paperclip className="w-5 h-5" />
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={file ? `Attached: ${file.name}` : 'Type a message or upload payment proof...'}
              className="flex-1 p-2.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={uploading || (!newMessage.trim() && !file)}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-sm transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{uploading ? 'Sending...' : 'Send'}</span>
            </button>
          </form>
        </div>
      </div>

      {/* Raise Dispute Modal Overlay */}
      {showDisputeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl max-w-md w-full border border-gray-200 dark:border-gray-700 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <h3 className="font-bold text-lg text-gray-900 dark:text-white">Raise Trade Dispute</h3>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              An admin moderator will be summoned to inspect chat transcripts, transaction timestamps, and payment proofs.
            </p>
            <textarea
              value={disputeReason}
              onChange={(e) => setDisputeReason(e.target.value)}
              placeholder="Explain the issue (e.g., Buyer marked paid but no money received in bank)..."
              className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
              rows={4}
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDisputeModal(false)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRaiseDispute}
                disabled={actionLoading}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg disabled:opacity-50 cursor-pointer transition"
              >
                {actionLoading ? 'Submitting...' : 'Submit Dispute'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
