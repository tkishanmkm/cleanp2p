"use client";

import React, { useState, useEffect, use } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AdminDisputeModeratorPage({ params }: { params: Promise<{ tradeId: string }> }) {
  const resolvedParams = use(params);
  const tradeId = resolvedParams.tradeId;

  const supabase = createClient();
  const [trade, setTrade] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [hasJoined, setHasJoined] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  useEffect(() => {
    fetchTradeAndChat();
    fetchAdminEmail();

    // Subscribe to realtime messages in dispute chat
    const channel = supabase
      .channel(`dispute-mod-${tradeId}`)
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
  }, [tradeId]);

  async function fetchAdminEmail() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) setAdminEmail(session.user.email);
  }

  async function fetchTradeAndChat() {
    // 1. Fetch trade details with buyer and seller info
    const { data: tradeData, error } = await supabase
      .from("trades")
      .select(`
        *,
        buyer:profiles!trades_buyer_id_fkey(user_custom_id, id),
        seller:profiles!trades_seller_id_fkey(user_custom_id, id)
      `)
      .eq("id", tradeId)
      .single();

    if (!error && tradeData) {
      setTrade(tradeData);
    } else {
      // Fallback query if FK joins vary
      const { data: simpleTrade } = await supabase
        .from("trades")
        .select("*")
        .eq("id", tradeId)
        .single();

      if (simpleTrade) {
        const ids = [simpleTrade.buyer_id, simpleTrade.seller_id].filter(Boolean);
        if (ids.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, user_custom_id")
            .in("id", ids);

          const profMap = new Map((profs || []).map((p: any) => [p.id, p]));
          simpleTrade.buyer = profMap.get(simpleTrade.buyer_id) || null;
          simpleTrade.seller = profMap.get(simpleTrade.seller_id) || null;
        }
        setTrade(simpleTrade);
      }
    }

    // 2. Fetch trade chat messages
    const { data: msgData } = await supabase
      .from("trade_chat_messages")
      .select("*")
      .eq("trade_id", tradeId)
      .order("created_at", { ascending: true });

    if (msgData) {
      setMessages(msgData);
      const alreadyJoined = msgData.some(
        (m) =>
          m.message?.includes("Paxones Moderator Joined") ||
          (m.is_system_message && m.message?.includes("Moderator"))
      );
      if (alreadyJoined) setHasJoined(true);
    }
  }

  async function handleJoinDispute() {
    if (!adminEmail) return alert("Admin email not found in active session.");

    const { data: { session } } = await supabase.auth.getSession();
    const senderId = session?.user?.id || "00000000-0000-0000-0000-000000000000";

    const { error } = await supabase.from("trade_chat_messages").insert({
      trade_id: tradeId,
      sender_id: senderId,
      sender_email: adminEmail,
      is_system_message: true,
      message: "Paxones Moderator Joined the Dispute",
    });

    if (error) {
      // Resilient fallback without optional schema fields
      await supabase.from("trade_chat_messages").insert({
        trade_id: tradeId,
        sender_id: senderId,
        message: "Paxones Moderator Joined the Dispute",
      });
    }

    setHasJoined(true);
    fetchTradeAndChat();
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const { data: { session } } = await supabase.auth.getSession();
    const senderId = session?.user?.id || "00000000-0000-0000-0000-000000000000";

    const msgText = `[MODERATOR]: ${newMessage}`;

    const { error } = await supabase.from("trade_chat_messages").insert({
      trade_id: tradeId,
      sender_id: senderId,
      sender_email: adminEmail,
      is_system_message: false,
      message: msgText,
    });

    if (error) {
      // Resilient fallback without optional schema fields
      await supabase.from("trade_chat_messages").insert({
        trade_id: tradeId,
        sender_id: senderId,
        message: msgText,
      });
    }

    setNewMessage("");
    fetchTradeAndChat();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-xl font-bold">Dispute Moderator Room</h1>
          <p className="text-xs text-gray-500 font-mono">Trade ID: {tradeId}</p>
          {trade && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              Buyer ID: <span className="font-mono font-semibold">{trade.buyer?.user_custom_id || trade.buyer_id}</span> | Seller ID: <span className="font-mono font-semibold">{trade.seller?.user_custom_id || trade.seller_id}</span>
            </p>
          )}
        </div>

        {!hasJoined && (
          <button
            onClick={handleJoinDispute}
            className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Join P2P Trade Dispute
          </button>
        )}
      </div>

      <div className="border rounded-xl p-4 bg-gray-50 dark:bg-gray-900 h-96 overflow-y-auto space-y-3">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-gray-500">
            No messages in this trade chat yet.
          </div>
        ) : (
          messages.map((m) => {
            const isSystem =
              m.is_system_message ||
              m.message?.includes("Moderator Joined") ||
              m.message?.startsWith("[SYSTEM]");

            return (
              <div
                key={m.id}
                className={`p-3 rounded-lg max-w-md ${
                  isSystem
                    ? "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-900 dark:text-yellow-200 border border-yellow-300 dark:border-yellow-800 mx-auto text-center font-bold text-xs"
                    : "bg-white dark:bg-gray-800 border"
                }`}
              >
                {!isSystem && (
                  <p className="text-xs text-gray-400 mb-1">{m.sender_email || (m.message?.startsWith("[MODERATOR]") ? "Moderator" : "User")}</p>
                )}
                <p className="text-sm">{m.message}</p>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSendMessage} className="flex space-x-2">
        <input
          type="text"
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Type message as moderator..."
          className="flex-1 p-2 border rounded-lg text-sm bg-transparent"
        />
        <button type="submit" className="bg-black dark:bg-white dark:text-black text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors">
          Send
        </button>
      </form>
    </div>
  );
}
