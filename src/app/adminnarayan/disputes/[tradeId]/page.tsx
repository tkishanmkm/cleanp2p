"use client";

import React, { useState, useEffect, use, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  AlertTriangle,
  Scale,
  RefreshCw,
  Send,
  Lock,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ExternalLink,
  DollarSign,
  Clock,
  MessageSquare,
  Users,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

export default function AdminDisputeModeratorPage({
  params,
}: {
  params?: Promise<{ tradeId: string }>;
}) {
  const router = useRouter();
  const routeParams = useParams();
  let resolvedTradeId = "";

  if (params) {
    if (typeof (params as any)?.then === "function") {
      try {
        resolvedTradeId = (use(params as Promise<{ tradeId: string }>) as any)?.tradeId || "";
      } catch {}
    } else if (typeof params === "object") {
      resolvedTradeId = (params as any)?.tradeId || "";
    }
  }

  const tradeId = resolvedTradeId || (routeParams?.tradeId as string) || "";

  const supabase = createClient();
  const [trade, setTrade] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [hasJoined, setHasJoined] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [confirmJoinModal, setConfirmJoinModal] = useState(false);
  const [resolveModal, setResolveModal] = useState<{
    isOpen: boolean;
    action: "release" | "refund";
    title: string;
    description: string;
  } | null>(null);
  const [resolutionReason, setResolutionReason] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchTradeAndChat = useCallback(async () => {
    if (!tradeId) return;

    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success && data.trade) {
        setTrade(data.trade);
        setMessages(data.messages || []);
        if (data.hasModeratorJoined) {
          setHasJoined(true);
        } else {
          const alreadyJoined = (data.messages || []).some(
            (m: any) =>
              m.message === "Paxones Moderator joined the trade chat." ||
              (typeof m.message === "string" && m.message.includes("Paxones Moderator joined"))
          );
          if (alreadyJoined) setHasJoined(true);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch admin trade dispute chat:", err);
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    fetchTradeAndChat();

    // Subscribe to realtime messages on trade_messages and trade_chat_messages
    const channel1 = supabase
      .channel(`admin-trade-msg-${tradeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trade_messages",
          filter: `trade_id=eq.${tradeId}`,
        },
        (payload) => {
          if (payload.new) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
            if (payload.new.message?.includes("Paxones Moderator joined")) {
              setHasJoined(true);
            }
          }
        }
      )
      .subscribe();

    const channel2 = supabase
      .channel(`admin-trade-chat-msg-${tradeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "trade_chat_messages",
          filter: `trade_id=eq.${tradeId}`,
        },
        (payload) => {
          if (payload.new) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === payload.new.id)) return prev;
              return [...prev, payload.new];
            });
            if (payload.new.message?.includes("Paxones Moderator joined")) {
              setHasJoined(true);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel1);
      supabase.removeChannel(channel2);
    };
  }, [tradeId, fetchTradeAndChat, supabase]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Execute Moderator Join
  const executeJoin = async () => {
    setIsJoining(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join" }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to join trade chat.");
      }

      setHasJoined(true);
      setConfirmJoinModal(false);
      setFeedback({
        type: "success",
        message: data.alreadyJoined
          ? "Moderator already active in this dispute room."
          : "Paxones Moderator joined the trade chat successfully.",
      });
      await fetchTradeAndChat();
    } catch (err: any) {
      setFeedback({ type: "error", message: `Join error: ${err.message}` });
    } finally {
      setIsJoining(false);
    }
  };

  // Send Moderator Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || isSending) return;

    const messageText = newMessage.trim();
    setIsSending(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", message: messageText }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to send moderator message.");
      }

      setNewMessage("");
      await fetchTradeAndChat();
    } catch (err: any) {
      setFeedback({ type: "error", message: `Message error: ${err.message}` });
    } finally {
      setIsSending(false);
    }
  };

  // Execute Dispute Resolution
  const handleResolveDispute = async () => {
    if (!resolveModal) return;
    if (!resolutionReason.trim()) {
      setFeedback({ type: "error", message: "Please provide a clear resolution reason for audit logging." });
      return;
    }

    setIsResolving(true);
    setFeedback(null);

    try {
      const disputeId = typeof trade?.dispute?.id === "string" ? trade.dispute.id : "";
      const internalTradeId = typeof trade?.id === "string" ? trade.id : "";
      if (!disputeId || !internalTradeId) {
        throw new Error("The open dispute could not be verified. Refresh the trade before resolving it.");
      }

      const res = await fetch("/api/admin/disputes/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          tradeId: internalTradeId,
          resolution: resolveModal.action === "release" ? "RELEASE" : "CANCEL",
          reason: resolutionReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok || data.success !== true || data.settlementSucceeded !== true || data.audit_logged !== true) {
        throw new Error(data.error || "Atomic dispute settlement and audit were not confirmed.");
      }

      setFeedback({
        type: "success",
        message: `Dispute successfully resolved: ${resolveModal.action === "release" ? "Escrow released to buyer" : "Escrow refunded to seller"}.`,
      });
      setResolveModal(null);
      setResolutionReason("");
      await fetchTradeAndChat();
    } catch (err: any) {
      setFeedback({ type: "error", message: `Resolution error: ${err.message}` });
    } finally {
      setIsResolving(false);
    }
  };

  const buyerName = trade?.buyer?.username || trade?.buyer?.full_name || trade?.buyer_id || "Buyer";
  const sellerName = trade?.seller?.username || trade?.seller?.full_name || trade?.seller_id || "Seller";
  const cryptoAsset = (trade?.crypto || trade?.crypto_currency || "USDT").toUpperCase();
  const cryptoAmount = trade?.amount || trade?.crypto_amount || 0;
  const fiatAmount = trade?.fiat_amount || 0;
  const fiatCurrency = (trade?.fiat_currency || "USD").toUpperCase();

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      {/* Top Navigation & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link
              href="/adminnarayan/disputes"
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-900 border border-slate-800 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Disputes
            </Link>
            <span className="text-xs px-2 py-0.5 rounded-full font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              DISPUTE ROOM
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Scale className="w-6 h-6 text-amber-400" />
            Trade Moderation &amp; Dispute Chat
          </h1>
          <p className="text-xs text-slate-400 font-mono">
            Trade Reference: <span className="text-amber-300 font-semibold">{tradeId}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTradeAndChat}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-amber-400" : ""}`} />
            Sync
          </button>

          {/* JOIN BUTTON OR ACTIVE BADGE - NEVER ANY LEAVE BUTTON */}
          {hasJoined ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-950/70 border border-emerald-700/80 text-emerald-300 shadow-sm">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              PAXONES MODERATOR ACTIVE
            </span>
          ) : (
            <button
              onClick={() => setConfirmJoinModal(true)}
              disabled={isJoining}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg shadow-md transition-all animate-pulse"
            >
              <ShieldAlert className="w-4 h-4" />
              JOIN TRADE CHAT
            </button>
          )}
        </div>
      </div>

      {/* Global Alert / Feedback Banner */}
      {feedback && (
        <div
          className={`p-4 rounded-lg border flex items-start justify-between gap-3 text-xs animate-in fade-in duration-150 ${
            feedback.type === "success"
              ? "bg-emerald-950/70 border-emerald-800 text-emerald-200"
              : "bg-rose-950/70 border-rose-800 text-rose-200"
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-white font-mono text-[10px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Trade & Dispute Intelligence Bar */}
      {trade && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Dispute Claim</p>
            <p className="text-xs font-bold text-white leading-snug">
              {trade.dispute?.reason || trade.dispute?.explanation || "Disputed by counterparty"}
            </p>
            <p className="text-[10px] text-slate-500 font-mono">
              Status: <span className="text-amber-400 uppercase font-bold">{trade.dispute?.status || "open"}</span>
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Escrow Locked</p>
            <p className="text-sm font-bold font-mono text-emerald-400">
              {cryptoAmount} {cryptoAsset}
            </p>
            <p className="text-[10px] text-slate-400 font-mono">
              Fiat: ${Number(fiatAmount).toLocaleString()} {fiatCurrency}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Counterparties</p>
            <div className="text-xs space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Buyer:</span>
                <span className="font-semibold text-blue-400">@{buyerName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Seller:</span>
                <span className="font-semibold text-emerald-400">@{sellerName}</span>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Moderation Actions</p>
            {trade.status === "completed" || trade.status === "released" || trade.status === "cancelled" ? (
              <span className="text-xs text-slate-400 font-mono font-semibold">
                Trade Terminal: <strong className="uppercase text-white">{trade.status}</strong>
              </span>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() =>
                    setResolveModal({
                      isOpen: true,
                      action: "release",
                      title: "Award Escrow to Buyer",
                      description: `This will trigger the canonical release_trade_escrow RPC, releasing ${cryptoAmount} ${cryptoAsset} from escrow to Buyer @${buyerName}.`,
                    })
                  }
                  className="px-2 py-1.5 bg-blue-600/90 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg transition-colors text-center"
                >
                  Award Buyer
                </button>
                <button
                  onClick={() =>
                    setResolveModal({
                      isOpen: true,
                      action: "refund",
                      title: "Award Escrow to Seller (Refund)",
                      description: `This will trigger the canonical cancel_p2p_trade RPC, refunding ${cryptoAmount} ${cryptoAsset} from escrow back to Seller @${sellerName}.`,
                    })
                  }
                  className="px-2 py-1.5 bg-rose-600/90 hover:bg-rose-500 text-white text-[11px] font-bold rounded-lg transition-colors text-center"
                >
                  Award Seller
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Moderator Chat Box */}
      <div className="rounded-2xl border border-slate-800 bg-slate-950 flex flex-col h-[560px] overflow-hidden shadow-2xl">
        {/* Chat Room Header */}
        <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              Live Trade Communication Stream
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            Total Messages: {messages.length}
          </span>
        </div>

        {/* Message Scroll View */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-950/60">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 text-xs">
              <MessageSquare className="w-8 h-8 text-slate-600 mb-2" />
              <p>No messages recorded in this trade chat yet.</p>
              <p className="text-[11px] text-slate-600">
                Join the chat or post instructions to communicate with buyer and seller.
              </p>
            </div>
          ) : (
            messages.map((m: any, idx: number) => {
              const text = String(m.message || "");
              const isJoinMessage =
                text === "Paxones Moderator joined the trade chat." ||
                text.includes("Paxones Moderator joined");
              const isSystem =
                m.is_system_message ||
                m.sender_id === "00000000-0000-0000-0000-000000000000" ||
                m.sender_username === "Paxones System" ||
                isJoinMessage ||
                text.startsWith("[SYSTEM]") ||
                text.includes("PAXONES ESCROW");

              const isModeratorMsg =
                !isJoinMessage &&
                (m.is_moderator ||
                  m.sender_username === "Paxones Moderator" ||
                  text.startsWith("Paxones Moderator\n"));

              const isBuyer = m.sender_id === trade?.buyer_id;
              const isSeller = m.sender_id === trade?.seller_id;

              // System Join or Status Bubble
              if (isSystem) {
                return (
                  <div
                    key={m.id || idx}
                    className={`p-3.5 rounded-xl border max-w-xl mx-auto my-2 text-center text-xs space-y-1 shadow-sm ${
                      isJoinMessage
                        ? "bg-purple-950/60 border-purple-700/80 text-purple-200"
                        : "bg-amber-950/40 border-amber-800/60 text-amber-200"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1.5 font-bold uppercase tracking-wider text-[10px]">
                      <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                      <span>{isJoinMessage ? "PAXONES MODERATION EVENT" : "PAXONES SYSTEM NOTICE"}</span>
                    </div>
                    <p className="font-semibold text-white whitespace-pre-wrap">{text}</p>
                    <p className="text-[10px] text-slate-400 font-mono pt-1">
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ""}
                    </p>
                  </div>
                );
              }

              // Moderator Message Bubble
              if (isModeratorMsg) {
                return (
                  <div key={m.id || idx} className="flex justify-end my-1.5">
                    <div className="max-w-lg p-3.5 rounded-2xl bg-amber-950/40 border border-amber-600/60 text-amber-100 rounded-br-xs shadow-md space-y-1">
                      <div className="flex items-center justify-between gap-3 border-b border-amber-700/40 pb-1">
                        <span className="text-[11px] font-bold text-amber-300 flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                          Paxones Moderator
                        </span>
                        <span className="text-[10px] font-mono text-amber-400/80">
                          {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ""}
                        </span>
                      </div>
                      <p className="text-xs whitespace-pre-wrap leading-relaxed text-white pt-1">
                        {text.replace(/^Paxones Moderator\n+/, "")}
                      </p>
                    </div>
                  </div>
                );
              }

              // Normal Counterparty Message (Buyer or Seller)
              return (
                <div
                  key={m.id || idx}
                  className={`flex my-1.5 ${isBuyer ? "justify-start" : "justify-start"}`}
                >
                  <div
                    className={`max-w-lg p-3.5 rounded-2xl border rounded-bl-xs shadow-sm space-y-1 ${
                      isBuyer
                        ? "bg-slate-900 border-blue-900/60 text-slate-200"
                        : "bg-slate-900 border-emerald-900/60 text-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1">
                      <span className={`text-[11px] font-bold ${isBuyer ? "text-blue-400" : "text-emerald-400"}`}>
                        {isBuyer ? `Buyer (@${buyerName})` : isSeller ? `Seller (@${sellerName})` : `User (@${m.sender_username || "Trader"})`}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ""}
                      </span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap leading-relaxed text-slate-100 pt-1">
                      {text}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Moderator Input Footer */}
        <div className="p-3 bg-slate-900/90 border-t border-slate-800">
          <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type message to buyer and seller as Paxones Moderator..."
              disabled={isSending}
              className="flex-1 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button
              type="submit"
              disabled={isSending || !newMessage.trim()}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {isSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          </form>
          <div className="flex justify-between items-center px-1 pt-1.5 text-[10px] text-slate-500">
            <span>Posted as <strong className="text-amber-400">Paxones Moderator</strong></span>
            <span>Visible to Buyer, Seller &amp; Audit Trail</span>
          </div>
        </div>
      </div>

      {/* CONFIRMATION MODAL: MODERATOR JOIN */}
      {confirmJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-slate-900 border border-purple-800/80 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-3 rounded-xl bg-purple-500/20 text-purple-400">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Join P2P Dispute Chat</h3>
                <p className="text-xs text-slate-400">Trade Ref: {tradeId}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-2">
              <p>
                Joining this trade will broadcast an official system message to both buyer (<strong className="text-blue-400">@{buyerName}</strong>) and seller (<strong className="text-emerald-400">@{sellerName}</strong>):
              </p>
              <p className="p-2.5 rounded bg-purple-950/40 border border-purple-800/60 font-semibold text-purple-200 text-center">
                &ldquo;Paxones Moderator joined the trade chat.&rdquo;
              </p>
              <p className="text-[11px] text-slate-400">
                Your presence will be logged in the admin audit history.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmJoinModal(false)}
                disabled={isJoining}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeJoin}
                disabled={isJoining}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold shadow-lg flex items-center gap-2"
              >
                {isJoining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Confirm &amp; Join
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL: DISPUTE SETTLEMENT */}
      {resolveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-3 rounded-xl ${
                  resolveModal.action === "release"
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-rose-500/20 text-rose-400"
                }`}
              >
                <Scale className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{resolveModal.title}</h3>
                <p className="text-xs text-slate-400">Trade: {tradeId}</p>
              </div>
            </div>

            <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed">
              {resolveModal.description}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Resolution Reason / Audit Justification (Required):
              </label>
              <textarea
                rows={3}
                value={resolutionReason}
                onChange={(e) => setResolutionReason(e.target.value)}
                placeholder="e.g. Buyer provided validated bank transfer receipt and seller confirmed cleared funds."
                className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-amber-500 resize-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setResolveModal(null)}
                disabled={isResolving}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResolveDispute}
                disabled={isResolving || !resolutionReason.trim()}
                className={`px-5 py-2 text-white rounded-lg text-xs font-semibold shadow-lg flex items-center gap-2 ${
                  resolveModal.action === "release"
                    ? "bg-blue-600 hover:bg-blue-500"
                    : "bg-rose-600 hover:bg-rose-500"
                }`}
              >
                {isResolving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Executing Settlement...
                  </>
                ) : (
                  <>Execute Resolution</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
