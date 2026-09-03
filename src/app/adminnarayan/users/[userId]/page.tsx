"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { 
  User, 
  ArrowLeft, 
  Coins, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  ArrowLeftRight, 
  FileText, 
  ShieldAlert, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  UserCheck, 
  UserX, 
  Crown,
  Activity,
  Calendar,
  Wallet,
  FileSpreadsheet,
  Copy,
  ExternalLink,
  Filter
} from "lucide-react";
import { formatUtcDateTime, formatCompactUtc } from "@/lib/date-utils";

export default function AdminUserDetailsPage({ params }: { params?: Promise<{ userId: string }> | { userId: string } }) {
  const routeParams = useParams();
  let resolvedUserId = "";

  if (params) {
    if (typeof (params as any)?.then === "function") {
      try {
        resolvedUserId = (use(params as Promise<{ userId: string }>) as any)?.userId || "";
      } catch {}
    } else if (typeof params === "object") {
      resolvedUserId = (params as any)?.userId || "";
    }
  }

  const userId = resolvedUserId || (routeParams?.userId as string) || "";

  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);
  const [wallets, setWallets] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");

  // Modals
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Balance Form
  const [currency, setCurrency] = useState("BTC");
  const [action, setAction] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [balanceReason, setBalanceReason] = useState("");

  // Status Form
  const [targetStatus, setTargetStatus] = useState<"Active" | "Restricted" | "Suspended" | "Banned">("Active");
  const [statusReason, setStatusReason] = useState("");

  // Tab
  const [activeTab, setActiveTab] = useState<"wallets" | "deposits" | "withdrawals" | "trades" | "ads" | "transactions" | "audit">("wallets");
  const [depositFilter, setDepositFilter] = useState<"all" | "completed" | "pending" | "failed">("all");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const copyToClipboard = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText(null), 2000);
    }
  };

  const fetchUserData = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      setErrorMessage("No user ID provided.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    // 1. Fetch via admin API route (bypasses RLS, joins all tables)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.success && data.user) {
        const u = data.user;
        setProfile(u);
        setWallets(u.wallets || []);
        setDeposits(u.deposits || []);
        setWithdrawals(u.withdrawals || []);
        setTrades(u.trades || []);
        setAds(u.ads || []);
        setTransactions(u.transactions || []);
        setAuditLogs(u.auditLogs || []);
        setTargetStatus(u.status || "Active");
        setStatusReason(u.ban_reason || "");
        setLoading(false);
        return;
      }
    } catch (apiErr) {
      console.warn("API user fetch fallback to client DB:", apiErr);
    }

    // 2. Client fallback
    let prof: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

    if (isUuid) {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
      prof = data;
    }

    if (!prof) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .or(`user_custom_id.eq.${userId},email.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      prof = data;
    }

    if (!prof) {
      setErrorMessage(`User "${userId}" not found in database.`);
      setLoading(false);
      return;
    }

    const actualId = prof.id;
    setProfile(prof);
    setTargetStatus(prof.status || (prof.is_banned ? "Banned" : prof.is_suspended ? "Suspended" : "Active"));
    setStatusReason(prof.ban_reason || "");

    const [
      { data: wData },
      { data: dData },
      { data: wdData },
      { data: tData },
      { data: adData },
      { data: txData },
      { data: aData },
    ] = await Promise.all([
      supabase.from("wallets").select("*").eq("user_id", actualId),
      supabase.from("deposits").select("*").eq("user_id", actualId).order("created_at", { ascending: false }),
      supabase.from("withdrawals").select("*").eq("user_id", actualId).order("created_at", { ascending: false }),
      supabase.from("trades").select("*").or(`buyer_id.eq.${actualId},seller_id.eq.${actualId}`).order("created_at", { ascending: false }),
      supabase.from("advertisements").select("*").eq("user_id", actualId).order("created_at", { ascending: false }),
      supabase.from("wallet_transactions").select("*").eq("user_id", actualId).order("created_at", { ascending: false }),
      supabase.from("admin_audit_logs").select("*").eq("target_user_id", actualId).order("created_at", { ascending: false }),
    ]);

    if (wData) setWallets(wData);
    if (dData) setDeposits(dData);
    if (wdData) setWithdrawals(wdData);
    if (tData) setTrades(tData);
    if (adData) setAds(adData);
    if (txData) setTransactions(txData);
    if (aData) setAuditLogs(aData);

    setLoading(false);
  }, [supabase, userId]);

  const fetchAdminSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) setAdminEmail(session.user.email);
  }, [supabase]);

  useEffect(() => {
    fetchUserData();
    fetchAdminSession();
  }, [fetchUserData, fetchAdminSession]);

  async function handleAdjustBalance(e: React.FormEvent) {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return alert("Invalid positive amount.");

    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/adjust-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: profile?.id || userId,
          currency,
          action,
          amount: numAmount,
          reason: balanceReason.trim(),
          adminEmail,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Adjustment failed.");
      }

      alert(`Balance adjusted! New ${currency} Balance: ${data.new_balance ?? "Updated"}`);
      setShowAdjustModal(false);
      setAmount("");
      setBalanceReason("");
      fetchUserData();
    } catch (err: any) {
      alert(`Adjustment failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdateStatus(newStatus: "Active" | "Restricted" | "Suspended" | "Banned", reason: string) {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(profile?.id || userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          status: newStatus,
          reason,
          adminEmail,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update user status.");
      }

      alert(`User status updated to ${newStatus}`);
      setShowStatusModal(false);
      fetchUserData();
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleRole() {
    if (!profile) return;
    const isCurrentlyAdmin = profile.role === "admin" || profile.is_admin_account;
    const newRole = isCurrentlyAdmin ? "user" : "admin";

    if (!confirm(`Are you sure you want to ${isCurrentlyAdmin ? "revoke admin status from" : "promote to Admin"} this user?`)) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(profile?.id || userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_role",
          role: newRole,
          adminEmail,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update role.");
      }

      alert(`User role updated to ${newRole}`);
      fetchUserData();
    } catch (err: any) {
      alert(`Role update error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-400">
        <p>Loading full user account records for inspection...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 text-center text-rose-500 space-y-4">
        <p>User profile not found for UUID {userId}.</p>
        <Link href="/adminnarayan/users" className="underline text-sm text-slate-400">
          Return to Users List
        </Link>
      </div>
    );
  }

  const isAdmin = profile.role === "admin" || profile.role === "super_admin" || profile.is_admin_account;
  const userStatus = profile.status || (profile.is_banned ? "Banned" : profile.is_suspended ? "Suspended" : "Active");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href="/adminnarayan/users"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Back to Users"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-white">
                {profile.full_name || "User Account Details"}
              </h1>
              {isAdmin ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-600/30 text-purple-200 border border-purple-500">
                  <Crown className="w-3.5 h-3.5 text-yellow-400" />
                  ADMIN
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                  User
                </span>
              )}
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                userStatus === "Active" 
                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  : userStatus === "Restricted"
                  ? "bg-amber-950 text-amber-300 border border-amber-800"
                  : userStatus === "Suspended"
                  ? "bg-orange-950 text-orange-300 border border-orange-800"
                  : "bg-rose-950 text-rose-300 border border-rose-800"
              }`}>
                {userStatus}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Email: <span className="text-slate-200">{profile.email}</span> | Custom ID: <span className="text-blue-400 font-semibold">{profile.user_custom_id || "None"}</span> | UUID: {profile.id}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowAdjustModal(true)}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-md transition-colors"
          >
            <Coins className="w-3.5 h-3.5" />
            Adjust Balance
          </button>
          <button
            onClick={() => setShowStatusModal(true)}
            className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-3 py-2 rounded-lg border border-slate-700 transition-colors"
          >
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Change Status
          </button>
          <button
            onClick={handleToggleRole}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border transition-colors ${
              isAdmin
                ? "bg-rose-950/80 text-rose-300 border-rose-800 hover:bg-rose-900"
                : "bg-purple-950/80 text-purple-200 border-purple-700 hover:bg-purple-900"
            }`}
          >
            <Crown className="w-3.5 h-3.5" />
            {isAdmin ? "Remove Admin" : "Make Admin"}
          </button>
        </div>
      </div>

      {/* Account Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Card 1: Identity */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-blue-400" />
            Identity & Activity
          </p>
          <div className="text-xs space-y-1 text-slate-300">
            <p><strong>Online Status:</strong> {profile.is_online ? <span className="text-emerald-400 font-semibold">Online</span> : <span className="text-slate-500">Offline</span>}</p>
            <p><strong>Last Seen:</strong> {profile.last_seen ? formatUtcDateTime(profile.last_seen) : "Recently active"}</p>
            <p><strong>Registered:</strong> {formatUtcDateTime(profile.created_at)}</p>
          </div>
        </div>

        {/* Card 2: Trading Stats */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            Trading Metrics
          </p>
          <div className="text-xs space-y-1 text-slate-300">
            <p><strong>Completed Trades:</strong> {profile.completed_trades || trades.filter(t => t.status === "completed").length || 0}</p>
            <p><strong>Total Trade Volume:</strong> ${Number(profile.trade_volume || 0).toFixed(2)}</p>
            <p><strong>Feedback Score:</strong> {profile.feedback_score ? `${profile.feedback_score}%` : "100% positive"}</p>
          </div>
        </div>

        {/* Card 3: Status & Restrictions */}
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 col-span-1 md:col-span-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Account Policy & Compliance
          </p>
          <div className="text-xs space-y-1 text-slate-300">
            <p><strong>Current Status:</strong> <span className="font-semibold text-white">{userStatus}</span></p>
            {profile.ban_reason ? (
              <p className="text-rose-400 font-medium">
                <strong>Restriction Reason:</strong> {profile.ban_reason}
              </p>
            ) : (
              <p className="text-emerald-400">Account in good standing with zero active restrictions.</p>
            )}
            {profile.banned_at && (
              <p className="text-slate-400 text-[11px]">Banned since: {formatUtcDateTime(profile.banned_at)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Wallets & Balances Overview Bar */}
      <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Wallet className="w-4 h-4 text-blue-400" />
            Cryptocurrency Balances
          </p>
          <button
            onClick={() => setShowAdjustModal(true)}
            className="text-xs text-blue-400 hover:text-blue-300 underline font-medium"
          >
            Adjust Balance
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {["BTC", "ETH", "USDT", "TRX"].map((sym) => {
            const w = wallets.find((item) => item.currency?.toUpperCase() === sym);
            const bal = w ? w.balance : "0.00000000";
            return (
              <div key={sym} className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-slate-400">{sym}</p>
                  <p className="text-lg font-mono font-bold text-white mt-0.5">{bal}</p>
                </div>
                <button
                  onClick={() => {
                    setCurrency(sym);
                    setShowAdjustModal(true);
                  }}
                  className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded border border-slate-700"
                >
                  +/-
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tab Navigation for Detailed Sections */}
      <div className="border-b border-slate-800 flex flex-wrap gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("wallets")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "wallets" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Wallets ({wallets.length})
        </button>
        <button
          onClick={() => setActiveTab("deposits")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "deposits" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Deposits ({deposits.length})
        </button>
        <button
          onClick={() => setActiveTab("withdrawals")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "withdrawals" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Withdrawals ({withdrawals.length})
        </button>
        <button
          onClick={() => setActiveTab("trades")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "trades" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Trades ({trades.length})
        </button>
        <button
          onClick={() => setActiveTab("ads")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "ads" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          P2P Ads ({ads.length})
        </button>
        <button
          onClick={() => setActiveTab("transactions")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "transactions" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Ledger Transactions ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`pb-2.5 px-3 border-b-2 transition-colors ${
            activeTab === "audit" 
              ? "border-blue-500 text-blue-400" 
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          Admin Actions ({auditLogs.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
        {activeTab === "wallets" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Wallet Accounts & Balances</h3>
              <span className="text-xs text-slate-400">Times displayed in UTC</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                  <tr>
                    <th className="p-3">Asset</th>
                    <th className="p-3">Available Balance</th>
                    <th className="p-3">Escrow / Reserved</th>
                    <th className="p-3">Total Balance</th>
                    <th className="p-3">Deposit Address & Network</th>
                    <th className="p-3">Last Activity (UTC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {wallets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-slate-500">No wallet records found for this user.</td>
                    </tr>
                  ) : (
                    wallets.map((w) => {
                      const curr = (w.currency || "USDT").toUpperCase();
                      const balance = parseFloat(w.balance) || 0;
                      const reserved = parseFloat(w.reserved_balance) || 0;
                      const available = Math.max(0, balance - reserved);
                      const addr = w.deposit_address || w.address || "On-demand";

                      return (
                        <tr key={w.id || curr} className="hover:bg-slate-800/40">
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold uppercase text-white">{curr}</span>
                              {w.network && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                                  {w.network}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3 font-mono font-bold text-emerald-400">
                            {available.toFixed(curr === 'BTC' ? 8 : 4)}
                          </td>
                          <td className="p-3 font-mono text-amber-400">
                            {reserved > 0 ? reserved.toFixed(curr === 'BTC' ? 8 : 4) : '0.00'}
                          </td>
                          <td className="p-3 font-mono font-bold text-slate-200">
                            {balance.toFixed(curr === 'BTC' ? 8 : 4)}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-slate-400">
                            {addr !== "On-demand" ? (
                              <div className="flex items-center gap-1.5">
                                <span className="truncate max-w-[200px]" title={addr}>{addr}</span>
                                <button
                                  onClick={() => copyToClipboard(addr)}
                                  className="text-slate-400 hover:text-white p-1"
                                  title="Copy address"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                                {copiedText === addr && (
                                  <span className="text-[10px] text-emerald-400">Copied</span>
                                )}
                              </div>
                            ) : (
                              <span className="italic text-slate-500">Generated on-demand</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-400">
                            {formatUtcDateTime(w.updated_at || w.created_at)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "deposits" && (
          <div className="space-y-4">
            {/* Deposit Attempts Summary Banner */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Credited Deposits</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">
                  {deposits.filter(d => ['completed', 'credited', 'confirmed'].includes((d.status || '').toLowerCase())).length}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Fully confirmed & credited</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Pending / Awaiting</p>
                <p className="text-xl font-bold text-amber-400 mt-1">
                  {deposits.filter(d => ['pending', 'awaiting_confirmation', 'detecting'].includes((d.status || '').toLowerCase())).length}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Awaiting blockchain blocks</p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-400">Failed / Rejected</p>
                <p className="text-xl font-bold text-rose-400 mt-1">
                  {deposits.filter(d => ['failed', 'rejected', 'cancelled', 'expired'].includes((d.status || '').toLowerCase())).length}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Unconfirmed / rejected attempts</p>
              </div>
            </div>

            {/* Status Filter Chips */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-slate-400 flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" /> Filter:
              </span>
              <button
                onClick={() => setDepositFilter("all")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  depositFilter === "all"
                    ? "bg-blue-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                All Attempts ({deposits.length})
              </button>
              <button
                onClick={() => setDepositFilter("completed")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  depositFilter === "completed"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Credited / Completed
              </button>
              <button
                onClick={() => setDepositFilter("pending")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  depositFilter === "pending"
                    ? "bg-amber-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Pending
              </button>
              <button
                onClick={() => setDepositFilter("failed")}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  depositFilter === "failed"
                    ? "bg-rose-600 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-white"
                }`}
              >
                Failed / Rejected
              </button>
            </div>

            {/* Deposits Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                  <tr>
                    <th className="p-3">Deposit ID</th>
                    <th className="p-3">Asset & Network</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Tx Hash / Explorer</th>
                    <th className="p-3">Receiving Address</th>
                    <th className="p-3">Confirmations</th>
                    <th className="p-3">Timestamp (UTC)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {deposits.filter((d) => {
                    const st = (d.status || '').toLowerCase();
                    if (depositFilter === "completed") return ['completed', 'credited', 'confirmed'].includes(st);
                    if (depositFilter === "pending") return ['pending', 'awaiting_confirmation', 'detecting'].includes(st);
                    if (depositFilter === "failed") return ['failed', 'rejected', 'cancelled', 'expired'].includes(st);
                    return true;
                  }).length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-slate-500">
                        No deposits match the selected filter.
                      </td>
                    </tr>
                  ) : (
                    deposits
                      .filter((d) => {
                        const st = (d.status || '').toLowerCase();
                        if (depositFilter === "completed") return ['completed', 'credited', 'confirmed'].includes(st);
                        if (depositFilter === "pending") return ['pending', 'awaiting_confirmation', 'detecting'].includes(st);
                        if (depositFilter === "failed") return ['failed', 'rejected', 'cancelled', 'expired'].includes(st);
                        return true;
                      })
                      .map((d) => {
                        const st = (d.status || '').toLowerCase();
                        const isCredited = ['completed', 'credited', 'confirmed'].includes(st);
                        const isFailed = ['failed', 'rejected', 'cancelled', 'expired'].includes(st);
                        const txHash = d.tx_hash || d.tx_id || d.hash;

                        return (
                          <tr key={d.id} className="hover:bg-slate-800/40">
                            <td className="p-3 font-mono text-slate-400">{d.id.slice(0, 8)}...</td>
                            <td className="p-3">
                              <span className="uppercase font-bold text-white">{d.currency || d.crypto || 'USDT'}</span>
                              {d.network && (
                                <span className="ml-1 text-[10px] text-slate-400">({d.network})</span>
                              )}
                            </td>
                            <td className="p-3 font-mono font-semibold text-emerald-400">
                              {parseFloat(d.amount).toFixed(d.currency === 'BTC' ? 8 : 4)}
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                isCredited
                                  ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                                  : isFailed
                                  ? "bg-rose-950 text-rose-300 border border-rose-800"
                                  : "bg-amber-950 text-amber-300 border border-amber-800"
                              }`}>
                                {d.status || 'pending'}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[11px] text-slate-400">
                              {txHash ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate max-w-[140px]" title={txHash}>{txHash}</span>
                                  <button
                                    onClick={() => copyToClipboard(txHash)}
                                    className="text-slate-400 hover:text-white p-0.5"
                                    title="Copy transaction hash"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <span className="italic text-slate-500">Pending broadcast</span>
                              )}
                            </td>
                            <td className="p-3 font-mono text-[11px] text-slate-400 truncate max-w-[140px]" title={d.address}>
                              {d.address || '—'}
                            </td>
                            <td className="p-3 font-mono text-[11px] text-slate-300">
                              {d.confirmations !== undefined
                                ? `${d.confirmations} / ${d.required_confirmations || 1}`
                                : isCredited
                                ? 'Confirmed'
                                : '0 / 1'}
                            </td>
                            <td className="p-3 text-slate-400 whitespace-nowrap">
                              {formatUtcDateTime(d.created_at)}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "withdrawals" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Withdrawal ID</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Destination Address</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">No withdrawals recorded for this user.</td>
                  </tr>
                ) : (
                  withdrawals.map((wd) => (
                    <tr key={wd.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-slate-400">{wd.id.slice(0, 8)}...</td>
                      <td className="p-3 uppercase font-bold text-white">{wd.currency || wd.asset_code}</td>
                      <td className="p-3 font-mono font-semibold text-rose-400">{wd.amount}</td>
                      <td className="p-3 font-mono text-[11px] text-slate-400">{wd.address || wd.destination_address}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          wd.status === "completed"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : wd.status === "queued"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : "bg-rose-950 text-rose-300 border border-rose-800"
                        }`}>
                          {wd.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400">{formatUtcDateTime(wd.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "trades" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Trade ID</th>
                  <th className="p-3">User Role</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Fiat Value</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Date (UTC)</th>
                  <th className="p-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {trades.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">No trade activity recorded for this user.</td>
                  </tr>
                ) : (
                  trades.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-blue-400 font-semibold">{t.id.slice(0, 8)}...</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.buyer_id === userId ? "bg-blue-950 text-blue-300" : "bg-purple-950 text-purple-300"
                        }`}>
                          {t.buyer_id === userId ? "Buyer" : "Seller"}
                        </span>
                      </td>
                      <td className="p-3 font-mono font-semibold">{t.amount} {t.crypto || t.crypto_currency}</td>
                      <td className="p-3 font-mono text-slate-400">${Number(t.fiat_amount || 0).toFixed(2)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          t.status === "completed"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : t.status === "disputed"
                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                            : "bg-amber-950 text-amber-300 border border-amber-800"
                        }`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400">{formatUtcDateTime(t.created_at)}</td>
                      <td className="p-3 text-right">
                        <Link
                          href={`/adminnarayan/trades/${t.id}`}
                          className="bg-slate-800 hover:bg-slate-700 text-white px-2.5 py-1 rounded text-[11px] font-medium border border-slate-700"
                        >
                          Open Trade
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "ads" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Ad ID</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Crypto</th>
                  <th className="p-3">Fiat</th>
                  <th className="p-3">Limits</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {ads.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">No active or historical P2P ads for this user.</td>
                  </tr>
                ) : (
                  ads.map((ad) => (
                    <tr key={ad.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-slate-400">{ad.id.slice(0, 8)}...</td>
                      <td className="p-3 uppercase font-bold text-white">{ad.type || ad.trade_type}</td>
                      <td className="p-3 font-bold uppercase">{ad.cryptocurrency || ad.crypto}</td>
                      <td className="p-3 uppercase text-slate-400">{ad.fiat_currency}</td>
                      <td className="p-3 font-mono">{ad.min_limit} - {ad.max_limit}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-800 text-slate-300">
                          {ad.status || "active"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "transactions" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Date (UTC)</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Asset</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Details / Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">No wallet transaction ledger records found.</td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/40">
                      <td className="p-3 text-slate-400">{formatUtcDateTime(tx.created_at)}</td>
                      <td className="p-3 uppercase font-bold text-white">{tx.tx_type}</td>
                      <td className="p-3 uppercase font-bold">{tx.asset_symbol}</td>
                      <td className="p-3 font-mono font-bold text-emerald-400">{tx.amount}</td>
                      <td className="p-3 font-mono text-[11px] text-slate-400 truncate max-w-sm">{tx.tx_hash || "Standard transfer"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Timestamp (UTC)</th>
                  <th className="p-3">Admin Email</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-500">No administrative actions logged on this user account.</td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/40">
                      <td className="p-3 text-slate-400">{formatUtcDateTime(log.created_at)}</td>
                      <td className="p-3 font-mono text-blue-400">{log.admin_email || log.admin_id}</td>
                      <td className="p-3 font-bold uppercase text-white">{log.action}</td>
                      <td className="p-3 font-mono text-[11px] text-slate-300">{JSON.stringify(log.details)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Adjust Balance Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Coins className="w-5 h-5 text-blue-400" />
                  Adjust Balance for User
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{profile.email} ({profile.id.slice(0, 8)}...)</p>
              </div>
              <button onClick={() => setShowAdjustModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Cryptocurrency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500"
                >
                  <option value="BTC">BTC — Bitcoin</option>
                  <option value="ETH">ETH — Ethereum</option>
                  <option value="USDT">USDT — Tether</option>
                  <option value="TRX">TRX — Tron</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Action</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAction("add")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      action === "add"
                        ? "bg-emerald-600 text-white border-emerald-500"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    + Add Funds
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction("subtract")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      action === "subtract"
                        ? "bg-rose-600 text-white border-rose-500"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    - Subtract Funds
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Crypto Amount</label>
                <input
                  type="number"
                  step="any"
                  min="0.00000001"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm font-mono text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Reason / Audit Note</label>
                <input
                  type="text"
                  required
                  value={balanceReason}
                  onChange={(e) => setBalanceReason(e.target.value)}
                  placeholder="Enter explicit reason for audit log..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-500 disabled:opacity-50"
                >
                  {actionLoading ? "Applying..." : "Confirm Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Status Modal */}
      {showStatusModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                  Update User Status
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{profile.email}</p>
              </div>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">New Account Status</label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white font-semibold"
                >
                  <option value="Active">Active — Full Access</option>
                  <option value="Restricted">Restricted — Trade Restrictions</option>
                  <option value="Suspended">Suspended — Temporary Lock</option>
                  <option value="Banned">Banned — Permanent Termination</option>
                </select>
              </div>

              {targetStatus !== "Active" && (
                <div>
                  <label className="text-xs font-semibold text-slate-300">Reason for {targetStatus} <span className="text-rose-400">*</span></label>
                  <input
                    type="text"
                    required
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder="Enter compliance or security violation reason..."
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white"
                  />
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleUpdateStatus(targetStatus, statusReason)}
                  disabled={actionLoading || (targetStatus !== "Active" && !statusReason.trim())}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-500 disabled:opacity-50"
                >
                  {actionLoading ? "Updating..." : "Save Status"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
