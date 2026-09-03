"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  ArrowLeft, 
  ShieldAlert, 
  ShieldCheck, 
  User, 
  Coins, 
  CheckCircle2, 
  RotateCcw, 
  ExternalLink,
  MessageSquare,
  AlertTriangle,
  Send,
  Lock,
  DollarSign
} from "lucide-react";
import { formatUtcDateTime } from "@/lib/date-utils";

export default function AdminTradeModeratorPage({ params }: { params?: Promise<{ tradeId: string }> | { tradeId: string } }) {
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
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  // Intervention Escrow Modal
  const [showInterveneModal, setShowInterveneModal] = useState(false);
  const [interveneAction, setInterveneAction] = useState<"release" | "refund">("release");
  const [interveneReason, setInterveneReason] = useState("");
  const [interveneLoading, setInterveneLoading] = useState(false);

  const fetchAdminSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) {
      setAdminEmail(session.user.email);
    }
  }, [supabase]);

  const fetchTradeAndChat = useCallback(async () => {
    if (!tradeId) {
      setLoading(false);
      setErrorMessage("No trade ID provided in route URL.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // 1. Fetch via admin API route (handles UUID or trade_id string, joins buyer/seller, bypasses RLS)
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`);
      const data = await res.json();

      if (data.success && data.trade) {
        setTrade(data.trade);
        setMessages(data.messages || []);
        const joinedBefore = (data.messages || []).some((m: any) =>
          m.message?.includes("Paxones Moderator Joined") ||
          (m.is_system_message && m.message?.toLowerCase().includes("moderator joined"))
        );
        if (joinedBefore) setHasJoined(true);
        setLoading(false);
        return;
      }
    } catch (apiErr) {
      console.warn("[TRADE MODERATOR] API fetch fallback to client DB:", apiErr);
    }

    // 2. Client fallback
    const { data: simpleTrade, error: fetchErr } = await supabase
      .from("trades")
      .select("*")
      .or(`id.eq.${tradeId},trade_id.eq.${tradeId}`)
      .maybeSingle();

    if (fetchErr || !simpleTrade) {
      setErrorMessage(fetchErr?.message || `Trade ID "${tradeId}" not found in database.`);
      setLoading(false);
      return;
    }

    const ids = [simpleTrade.buyer_id, simpleTrade.seller_id].filter(Boolean);
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, email, full_name, user_custom_id")
        .in("id", ids);

      const pMap = new Map((profs || []).map((p: any) => [p.id, p]));
      simpleTrade.buyer = pMap.get(simpleTrade.buyer_id) || null;
      simpleTrade.seller = pMap.get(simpleTrade.seller_id) || null;
    }
    setTrade(simpleTrade);

    const { data: msgData } = await supabase
      .from("trade_chat_messages")
      .select("*")
      .eq("trade_id", simpleTrade.id)
      .order("created_at", { ascending: true });

    if (msgData) {
      setMessages(msgData);
      const joinedBefore = msgData.some((m: any) =>
        m.message?.includes("Paxones Moderator Joined") ||
        (m.is_system_message && m.message?.toLowerCase().includes("moderator joined"))
      );
      if (joinedBefore) setHasJoined(true);
    }

    setLoading(false);
  }, [supabase, tradeId]);

  useEffect(() => {
    fetchAdminSession();
    fetchTradeAndChat();

    // Subscribe to live trade chat messages
    const channel = supabase
      .channel(`trade-chat-${tradeId}`)
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
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAdminSession, fetchTradeAndChat, supabase, tradeId]);

  // Join as Moderator Handler
  async function handleJoinAsModerator() {
    if (!adminEmail) return alert("Admin email session not identified.");

    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", adminEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setHasJoined(true);
        fetchTradeAndChat();
        return;
      }
    } catch (apiErr) {
      console.warn("API join fallback to client DB:", apiErr);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const senderId = session?.user?.id || "00000000-0000-0000-0000-000000000000";
    const systemMsg = "Paxones Moderator Joined";

    await supabase.from("trade_chat_messages").insert({
      trade_id: trade?.id || tradeId,
      sender_id: senderId,
      message: systemMsg,
    });

    setHasJoined(true);
    fetchTradeAndChat();
  }

  // Send message as Moderator
  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    setSendLoading(true);
    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "message", message: newMessage.trim(), adminEmail }),
      });
      const data = await res.json();
      if (data.success) {
        setNewMessage("");
        setSendLoading(false);
        fetchTradeAndChat();
        return;
      }
    } catch (apiErr) {
      console.warn("API message send fallback to client DB:", apiErr);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const senderId = session?.user?.id || "00000000-0000-0000-0000-000000000000";
    const formattedMsg = `[MODERATOR]: ${newMessage.trim()}`;

    await supabase.from("trade_chat_messages").insert({
      trade_id: trade?.id || tradeId,
      sender_id: senderId,
      message: formattedMsg,
    });

    setNewMessage("");
    setSendLoading(false);
    fetchTradeAndChat();
  }

  // Escrow Intervention (Release or Refund with Audit Logging & Scam Protection)
  async function handleInterveneEscrow(e: React.FormEvent) {
    e.preventDefault();
    if (!trade) return;
    if (!adminEmail) return alert("Admin email missing from active session.");
    if (!interveneReason.trim()) return alert("Mandatory reason required for escrow intervention audit.");

    setInterveneLoading(true);

    try {
      const res = await fetch(`/api/admin/trades/${encodeURIComponent(tradeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "intervene",
          interveneAction,
          reason: interveneReason.trim(),
          adminEmail,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Intervention failed.");
      }

      alert(data.message || `Escrow ${interveneAction} completed successfully.`);
      setShowInterveneModal(false);
      setInterveneReason("");
      fetchTradeAndChat();
    } catch (err: any) {
      alert(`Intervention failed: ${err.message}`);
    } finally {
      setInterveneLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>Loading trade oversight and chat records...</p>
      </div>
    );
  }

  if (!trade || errorMessage) {
    return (
      <div className="p-8 text-center text-rose-500 space-y-4">
        <p>{errorMessage || `Trade ID "${tradeId}" not found in the platform database.`}</p>
        <Link href="/adminnarayan/trades" className="underline text-sm text-slate-400">
          Return to Trades
        </Link>
      </div>
    );
  }

  const cryptoSym = trade.crypto || trade.crypto_currency || "USDT";
  const fiatSym = trade.fiat_currency || "USD";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/adminnarayan/trades"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-purple-400" />
                Trade Moderator Oversight Room
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                trade.status === "completed"
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : trade.status === "disputed"
                  ? "bg-rose-950 text-rose-300 border border-rose-800"
                  : "bg-amber-950 text-amber-300 border border-amber-800"
              }`}>
                {trade.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Trade UUID: {trade.id} | Created: {formatUtcDateTime(trade.created_at)}
            </p>
          </div>
        </div>

        {/* Top Moderator Controls */}
        <div className="flex items-center gap-2">
          {!hasJoined ? (
            <button
              onClick={handleJoinAsModerator}
              className="bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs px-4 py-2 rounded-lg shadow-md shadow-purple-600/30 transition-colors flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4" />
              Join as Moderator
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Moderator Active in Room
            </span>
          )}

          {/* Protective Intervention Button */}
          {trade.status !== "completed" && trade.status !== "cancelled" && (
            <button
              onClick={() => {
                setInterveneAction("release");
                setInterveneReason("");
                setShowInterveneModal(true);
              }}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs px-3.5 py-2 rounded-lg shadow-md transition-colors flex items-center gap-1.5"
            >
              <AlertTriangle className="w-4 h-4" />
              Intervene & Protect Escrow
            </button>
          )}
        </div>
      </div>

      {/* Trade Overview Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Buyer Card */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-400 flex items-center justify-between">
            <span>Buyer</span>
            {trade.buyer?.id && (
              <Link
                href={`/adminnarayan/users/${trade.buyer.id}`}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
              >
                Inspect User <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </p>
          <p className="font-semibold text-white">{trade.buyer?.full_name || "Customer Buyer"}</p>
          <p className="text-xs text-slate-400 font-mono">{trade.buyer?.email || "No email"}</p>
          <p className="text-[11px] text-slate-500 font-mono">
            Custom ID: <span className="text-slate-300">{trade.buyer?.user_custom_id || "N/A"}</span>
          </p>
        </div>

        {/* Seller Card */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-purple-400 flex items-center justify-between">
            <span>Seller</span>
            {trade.seller?.id && (
              <Link
                href={`/adminnarayan/users/${trade.seller.id}`}
                className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1"
              >
                Inspect User <ExternalLink className="w-3 h-3" />
              </Link>
            )}
          </p>
          <p className="font-semibold text-white">{trade.seller?.full_name || "Customer Seller"}</p>
          <p className="text-xs text-slate-400 font-mono">{trade.seller?.email || "No email"}</p>
          <p className="text-[11px] text-slate-500 font-mono">
            Custom ID: <span className="text-slate-300">{trade.seller?.user_custom_id || "N/A"}</span>
          </p>
        </div>

        {/* Financial Escrow Details */}
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" />
            Escrowed Asset
          </p>
          <p className="text-xl font-mono font-bold text-white">
            {trade.amount} <span className="text-emerald-400">{cryptoSym}</span>
          </p>
          <p className="text-xs text-slate-400 font-mono">
            Fiat Value: ${Number(trade.fiat_amount || 0).toFixed(2)} {fiatSym}
          </p>
          <p className="text-[11px] text-slate-500">
            Payment Method: <span className="text-slate-300">{trade.payment_method || "Direct Bank/P2P"}</span>
          </p>
        </div>
      </div>

      {/* Live Trade Chat & Moderator Console */}
      <div className="border border-slate-800 rounded-2xl bg-slate-900/90 shadow-xl overflow-hidden flex flex-col h-[520px]">
        {/* Chat Top Banner */}
        <div className="p-3.5 bg-slate-950 border-b border-slate-800 flex justify-between items-center text-xs">
          <span className="font-semibold text-slate-300 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-purple-400" />
            Live Marketplace Trade Chat
          </span>
          <span className="text-slate-500 font-mono">
            Admin: <strong className="text-purple-300">{adminEmail || "Authenticated"}</strong>
          </span>
        </div>

        {/* Chat Messages Log */}
        <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-950/40">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              No chat messages recorded in this trade session yet.
            </div>
          ) : (
            messages.map((m) => {
              const msgLower = (m.message || "").toLowerCase();
              const isSystem =
                m.is_system_message ||
                msgLower.includes("paxones moderator joined") ||
                msgLower.includes("moderator joined") ||
                msgLower.startsWith("[system]") ||
                msgLower.includes("released escrow") ||
                msgLower.includes("refunded escrow");

              const isModerator =
                m.message?.startsWith("[MODERATOR]") ||
                m.sender_email === adminEmail;

              if (isSystem) {
                return (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-200 text-xs text-center font-semibold max-w-lg mx-auto shadow-sm"
                  >
                    {m.message}
                    <p className="text-[10px] text-amber-400/70 font-mono mt-0.5">
                      {new Date(m.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl max-w-lg space-y-1 ${
                    isModerator
                      ? "ml-auto bg-purple-950/50 border border-purple-800 text-purple-100"
                      : "mr-auto bg-slate-900 border border-slate-800 text-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`font-bold ${isModerator ? "text-purple-300" : "text-slate-400"}`}>
                      {isModerator ? "Paxones Moderator" : (m.sender_email || "User")}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(m.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-sm break-words whitespace-pre-wrap">{m.message}</p>
                </div>
              );
            })
          )}
        </div>

        {/* Chat Input or Join Prompt */}
        <div className="p-3 bg-slate-950 border-t border-slate-800">
          {!hasJoined ? (
            <div className="flex items-center justify-between p-2 rounded-lg bg-purple-950/40 border border-purple-800/80 text-xs">
              <span className="text-purple-200">
                You are currently reviewing this trade in observe mode. Join as moderator to communicate with parties.
              </span>
              <button
                onClick={handleJoinAsModerator}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg text-xs"
              >
                Join as Moderator
              </button>
            </div>
          ) : (
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type moderator message to buyer and seller..."
                className="flex-1 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                type="submit"
                disabled={sendLoading || !newMessage.trim()}
                className="px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Escrow Intervention Modal */}
      {showInterveneModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                  Admin Protective Escrow Intervention
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Trade: {trade.id.slice(0, 8)}...</p>
              </div>
              <button onClick={() => setShowInterveneModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleInterveneEscrow} className="space-y-4">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs space-y-1">
                <p><strong>Amount to Transfer:</strong> <span className="font-mono text-emerald-400">{trade.amount} {cryptoSym}</span></p>
                <p><strong>Buyer:</strong> {trade.buyer?.email} ({trade.buyer?.user_custom_id})</p>
                <p><strong>Seller:</strong> {trade.seller?.email} ({trade.seller?.user_custom_id})</p>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Intervention Decision</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setInterveneAction("release")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      interveneAction === "release"
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    Release to Buyer
                  </button>
                  <button
                    type="button"
                    onClick={() => setInterveneAction("refund")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      interveneAction === "refund"
                        ? "bg-amber-600 text-white border-amber-500 shadow-md"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    Refund to Seller
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">
                  Mandatory Audit Reason / Scam Prevention Note <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={interveneReason}
                  onChange={(e) => setInterveneReason(e.target.value)}
                  placeholder="State evidence, payment verification, or fraudulent activity justification..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-xs text-white focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="text-[11px] text-slate-400 bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                • Audit log will record: Admin ({adminEmail}), Trade ID, Action, Amount ({trade.amount} {cryptoSym}), Reason, and Date.
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInterveneModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={interveneLoading}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {interveneLoading ? "Executing Intervention..." : "Confirm & Execute"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
