'use client';

import React, { useEffect, useState } from 'react';
import { createClientComponentClient } from '@/utils/supabase/client';
import Link from 'next/link';
import { ShieldAlert, CheckCircle, RefreshCw, FileText, ArrowLeft, AlertCircle } from 'lucide-react';

export default function AdminDisputesPage() {
  const supabase = createClientComponentClient();
  const [disputes, setDisputes] = useState<any[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusFeedback, setStatusFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadDisputes();
  }, []);

  async function loadDisputes() {
    setLoading(true);
    try {
      // 1. Try joined query with profiles
      const { data, error } = await supabase
        .from('trades')
        .select(`
          *,
          buyer:profiles!trades_buyer_id_fkey(username),
          seller:profiles!trades_seller_id_fkey(username)
        `)
        .or('status.eq.DISPUTED,status.eq.disputed')
        .order('disputed_at', { ascending: false });

      if (!error && data && data.length > 0) {
        setDisputes(data);
      } else {
        // Fallback: simple trades query without foreign key constraint
        const { data: flatData } = await supabase
          .from('trades')
          .select('*')
          .or('status.eq.DISPUTED,status.eq.disputed')
          .order('created_at', { ascending: false });

        if (flatData) {
          // Fetch profiles separately
          const enriched = await Promise.all(
            flatData.map(async (t) => {
              const [bRes, sRes] = await Promise.all([
                t.buyer_id ? supabase.from('profiles').select('username').eq('id', t.buyer_id).maybeSingle() : { data: null },
                t.seller_id ? supabase.from('profiles').select('username').eq('id', t.seller_id).maybeSingle() : { data: null },
              ]);
              return {
                ...t,
                buyer: bRes.data || { username: 'Buyer' },
                seller: sRes.data || { username: 'Seller' },
              };
            })
          );
          setDisputes(enriched);
        }
      }
    } catch (err) {
      console.warn('Error loading disputes:', err);
    } finally {
      setLoading(false);
    }
  }

  async function inspectTrade(trade: any) {
    setSelectedTrade(trade);
    setStatusFeedback(null);
    try {
      const { data } = await supabase
        .from('trade_messages')
        .select('*')
        .eq('trade_id', trade.id)
        .order('created_at', { ascending: true });

      if (data) {
        setMessages(
          data.map((m: any) => ({
            id: m.id,
            sender_id: m.sender_id,
            content: m.content || m.message || '',
            file_url: m.file_url || m.attachment_url || null,
            is_system_message: Boolean(m.is_system_message ?? m.is_system),
            created_at: m.created_at,
          }))
        );
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.warn('Could not load trade messages for inspection:', err);
      setMessages([]);
    }
  }

  async function handleResolve(resolution: 'RELEASE_TO_BUYER' | 'REFUND_TO_SELLER') {
    if (!selectedTrade) return;
    const readable = resolution === 'RELEASE_TO_BUYER' ? 'Release Escrow to Buyer' : 'Refund Escrow to Seller';
    if (!confirm(`Are you sure you want to resolve this trade as: ${readable}?`)) return;

    setResolving(true);
    setStatusFeedback(null);
    try {
      const res = await fetch(`/api/admin/disputes/${selectedTrade.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution, notes: resolutionNotes }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatusFeedback({ type: 'error', message: data.error || 'Failed to resolve dispute.' });
      } else {
        setStatusFeedback({ type: 'success', message: data.message || 'Dispute resolved successfully.' });
        setResolutionNotes('');
        setSelectedTrade(null);
        await loadDisputes();
      }
    } catch (err) {
      setStatusFeedback({ type: 'error', message: 'Network error occurred while resolving dispute.' });
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 min-h-[85vh]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b pb-4 dark:border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Dispute Moderation</h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Inspect transaction histories, escrow status, and execute server-authoritative resolutions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadDisputes}
            disabled={loading}
            className="px-3.5 py-2 text-xs font-medium border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex items-center gap-1.5 transition text-gray-700 dark:text-gray-200 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <Link
            href="/adminnarayan/trades"
            className="px-3.5 py-2 text-xs font-semibold bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:opacity-90 transition inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Admin Trades</span>
          </Link>
        </div>
      </div>

      {statusFeedback && (
        <div
          className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
            statusFeedback.type === 'success'
              ? 'bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
          }`}
        >
          {statusFeedback.type === 'success' ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusFeedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Disputes List */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3 shadow-sm h-fit">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Active Disputes ({disputes.length})
            </h3>
            {loading && <span className="text-[11px] text-gray-400">Syncing...</span>}
          </div>

          {disputes.length === 0 && !loading && (
            <div className="text-center py-10 text-gray-400 space-y-2">
              <CheckCircle className="w-8 h-8 mx-auto text-emerald-500 opacity-80" />
              <p className="text-xs">No active disputes requiring review.</p>
            </div>
          )}

          <div className="space-y-2.5 max-h-[600px] overflow-y-auto">
            {disputes.map((d) => {
              const isSelected = selectedTrade?.id === d.id;
              const fiat = Number(d.fiat_amount ?? d.amount_usd ?? 0);
              const fiatCurr = d.fiat_currency ?? d.fiat ?? 'USD';
              const crypto = Number(d.crypto_amount ?? d.amount ?? 0);
              const cryptoCurr = d.crypto ?? d.asset ?? 'BTC';

              return (
                <div
                  key={d.id}
                  onClick={() => inspectTrade(d)}
                  className={`p-3.5 rounded-lg border cursor-pointer transition ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/50'
                  }`}
                >
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span className="font-mono text-gray-800 dark:text-gray-200">
                      Trade #{d.id?.substring(0, 8)}
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      ${fiat.toLocaleString()} {fiatCurr}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Buyer: <span className="text-gray-700 dark:text-gray-300">@{d.buyer?.username || 'Buyer'}</span> | Seller:{' '}
                    <span className="text-gray-700 dark:text-gray-300">@{d.seller?.username || 'Seller'}</span>
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Escrow: {crypto} {cryptoCurr}
                  </p>
                  <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700/60">
                    <p className="text-[11px] text-red-500 dark:text-red-400 truncate font-medium">
                      Reason: {d.dispute_reason || 'Dispute opened by party'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Audit Inspector Panel */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col justify-between">
          {selectedTrade ? (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-700 gap-2">
                <div>
                  <h2 className="font-bold text-lg text-gray-900 dark:text-white">
                    Inspecting Trade #{selectedTrade.id}
                  </h2>
                  <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                    Reason: {selectedTrade.dispute_reason || 'Dispute opened'}
                  </p>
                </div>
                <div className="text-left sm:text-right text-xs">
                  <p className="font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    ${Number(selectedTrade.fiat_amount ?? selectedTrade.amount_usd ?? 0).toLocaleString()} {selectedTrade.fiat_currency ?? 'USD'}
                  </p>
                  <p className="text-gray-400">
                    {selectedTrade.crypto_amount ?? selectedTrade.amount ?? 0} {selectedTrade.crypto ?? 'Crypto'} locked in escrow
                  </p>
                </div>
              </div>

              {/* Message Transcript */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-gray-600 dark:text-gray-400">
                  <span>Chat Transcript & Evidence Audit ({messages.length})</span>
                  <span className="text-[11px] text-gray-400">Order: Oldest to Newest</span>
                </div>

                <div className="h-64 overflow-y-auto border rounded-lg p-3 space-y-2.5 bg-gray-50 dark:bg-gray-900 text-xs border-gray-200 dark:border-gray-700">
                  {messages.length === 0 ? (
                    <p className="text-center text-gray-400 py-10">No chat messages recorded for this trade.</p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={`p-2.5 rounded-lg border text-xs ${
                          m.is_system_message
                            ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200'
                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold uppercase tracking-wider text-[10px] opacity-75">
                            {m.is_system_message ? 'SYSTEM AUDIT' : `USER ${m.sender_id?.substring(0, 8)}`}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap">{m.content}</p>
                        {m.file_url && (
                          <a
                            href={m.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 underline mt-1.5 font-medium hover:opacity-80 transition"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>View Attachment Proof</span>
                          </a>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Resolution Controls */}
              <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 block">
                  Moderator Audit Notes
                </label>
                <textarea
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  placeholder="Enter audit rationale (e.g., Valid bank receipt verified, transferring cryptocurrency to buyer)..."
                  className="w-full p-3 border rounded-lg text-xs bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={() => handleResolve('RELEASE_TO_BUYER')}
                    disabled={resolving}
                    className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>{resolving ? 'Resolving...' : 'Force Release to Buyer'}</span>
                  </button>
                  <button
                    onClick={() => handleResolve('REFUND_TO_SELLER')}
                    disabled={resolving}
                    className="py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg transition disabled:opacity-50 cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>{resolving ? 'Resolving...' : 'Force Refund to Seller'}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-400 py-20 text-sm space-y-2">
              <ShieldAlert className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600" />
              <p>Select a disputed trade from the left panel to begin moderation and audit.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
