"use client";

import React, { useState, useEffect, use, useCallback } from "react";
import Link from "next/link";
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
  FileSpreadsheet
} from "lucide-react";

export default function AdminUserDetailsPage({ params }: { params: Promise<{ userId: string }> }) {
  const resolvedParams = use(params);
  const userId = resolvedParams.userId;

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

  const fetchUserData = useCallback(async () => {
    setLoading(true);

    // 1. Profile (by UUID or fallback by custom ID / username)
    let prof: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

    if (isUuid) {
      const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
      prof = data;
    }

    if (!prof) {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .or(`user_custom_id.eq.${userId},username.eq.${userId},email.eq.${userId}`)
        .limit(1)
        .single();
      prof = data;
    }

    const actualId = prof?.id || userId;

    if (prof) {
      setProfile(prof);
      setTargetStatus(prof.status || (prof.is_banned ? "Banned" : prof.is_suspended ? "Suspended" : "Active"));
      setStatusReason(prof.ban_reason || "");
    }

    // 2. Wallets
    const { data: wData } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", actualId);
    if (wData) setWallets(wData);

    // 3. Deposits
    const { data: dData } = await supabase
      .from("deposits")
      .select("*")
      .eq("user_id", actualId)
      .order("created_at", { ascending: false });
    if (dData) setDeposits(dData);

    // 4. Withdrawals
    const { data: wdData } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("user_id", actualId)
      .order("created_at", { ascending: false });
    if (wdData) setWithdrawals(wdData);

    // 5. Trades
    const { data: tData } = await supabase
      .from("trades")
      .select("*")
      .or(`buyer_id.eq.${actualId},seller_id.eq.${actualId}`)
      .order("created_at", { ascending: false });
    if (tData) setTrades(tData);

    // 6. Ads
    const { data: adsData } = await supabase
      .from("ads")
      .select("*")
      .eq("user_id", actualId)
      .order("created_at", { ascending: false });
    if (adsData) setAds(adsData);

    // 7. Wallet Transactions
    const { data: txData } = await supabase
      .from("wallet_transactions")
      .select("*")
      .eq("user_id", actualId)
      .order("created_at", { ascending: false });
    if (txData) setTransactions(txData);

    // 8. Audit Logs
    const { data: aData } = await supabase
      .from("admin_audit_logs")
      .select("*")
      .eq("target_user_id", userId)
      .order("created_at", { ascending: false });
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
    if (!adminEmail) return alert("Admin session missing. Please re-authenticate.");
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return alert("Invalid positive amount.");

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_adjust_balance", {
        p_admin_email: adminEmail,
        p_target_user_id: userId,
        p_currency: currency,
        p_action: action,
        p_amount: numAmount,
      });

      if (error) throw new Error(error.message);

      const note = balanceReason.trim() || `Admin manual ${action} by ${adminEmail}`;

      // Insert ledger transaction
      await supabase.from("wallet_transactions").insert({
        user_id: userId,
        tx_type: action === "add" ? "credit" : "debit",
        asset_symbol: currency,
        amount: numAmount,
        status: "completed",
        tx_hash: `ADMIN_ADJ:${action.toUpperCase()}:${note}`,
      });

      // Insert audit log
      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: "ADJUST_BALANCE",
        target_user_id: userId,
        details: {
          currency,
          action,
          amount: numAmount,
          reason: note,
          new_balance: data?.new_balance,
          date: new Date().toISOString(),
        },
      });

      alert(`Balance adjusted! New ${currency} Balance: ${data?.new_balance ?? "Updated"}`);
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
      const isBanned = newStatus === "Banned";
      const isSuspended = newStatus === "Suspended";
      const isRestricted = newStatus === "Restricted";

      const updatePayload: any = {
        status: newStatus,
        is_banned: isBanned,
        is_suspended: isSuspended,
        ban_reason: (isBanned || isSuspended || isRestricted) ? reason : null,
      };

      if (isBanned) {
        updatePayload.banned_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from("profiles")
        .update(updatePayload)
        .eq("id", userId);

      if (error) throw new Error(error.message);

      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: `USER_STATUS_${newStatus.toUpperCase()}`,
        target_user_id: userId,
        details: {
          previous_status: profile?.status,
          new_status: newStatus,
          reason: reason || "Admin updated status",
          date: new Date().toISOString(),
        },
      });

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
      const { error } = await supabase
        .from("profiles")
        .update({
          role: newRole,
          is_admin_account: newRole === "admin",
        })
        .eq("id", userId);

      if (error) throw new Error(error.message);

      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: newRole === "admin" ? "MAKE_ADMIN" : "REMOVE_ADMIN",
        target_user_id: userId,
        details: { target_email: profile.email, new_role: newRole, date: new Date().toISOString() },
      });

      alert(`Role updated to ${newRole.toUpperCase()}`);
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
            <p><strong>Last Seen:</strong> {profile.last_seen ? new Date(profile.last_seen).toLocaleString() : "Recently active"}</p>
            <p><strong>Registered:</strong> {new Date(profile.created_at).toLocaleDateString()}</p>
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
              <p className="text-slate-400 text-[11px]">Banned since: {new Date(profile.banned_at).toLocaleString()}</p>
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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Balance</th>
                  <th className="p-3">Deposit Address</th>
                  <th className="p-3">Updated At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {wallets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-slate-500">No wallet records found.</td>
                  </tr>
                ) : (
                  wallets.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-bold uppercase text-white">{w.currency}</td>
                      <td className="p-3 font-mono font-bold text-emerald-400">{w.balance}</td>
                      <td className="p-3 font-mono text-[11px] text-slate-400">{w.address || "On-demand"}</td>
                      <td className="p-3 text-slate-400">{new Date(w.updated_at || w.created_at).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "deposits" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="p-3">Deposit ID</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {deposits.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-500">No deposits recorded for this user.</td>
                  </tr>
                ) : (
                  deposits.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-slate-400">{d.id.slice(0, 8)}...</td>
                      <td className="p-3 uppercase font-bold text-white">{d.currency}</td>
                      <td className="p-3 font-mono font-semibold text-emerald-400">{d.amount}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          d.status === "completed" || d.status === "credited"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : "bg-amber-950 text-amber-300 border border-amber-800"
                        }`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="p-3 text-slate-400">{new Date(d.created_at).toLocaleString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
                      <td className="p-3 text-slate-400">{new Date(wd.created_at).toLocaleString()}</td>
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
                  <th className="p-3">Date</th>
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
                      <td className="p-3 text-slate-400">{new Date(t.created_at).toLocaleString()}</td>
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
                  <th className="p-3">Date</th>
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
                      <td className="p-3 text-slate-400">{new Date(tx.created_at).toLocaleString()}</td>
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
                  <th className="p-3">Timestamp</th>
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
                      <td className="p-3 text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
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
