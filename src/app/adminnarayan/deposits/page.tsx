"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 
  ArrowDownToLine, 
  Search, 
  Coins, 
  ExternalLink, 
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle
} from "lucide-react";

export default function AdminDepositsPage() {
  const supabase = createClient();
  const [deposits, setDeposits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Adjust Balance Modal
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [targetUserInfo, setTargetUserInfo] = useState<any>(null);
  const [currency, setCurrency] = useState("BTC");
  const [action, setAction] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAdminSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) {
      setAdminEmail(session.user.email);
    }
  }, [supabase]);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);

    let fetchedData: any[] | null = null;

    // 1. Attempt join with profiles
    const { data: joinedData, error: joinError } = await supabase
      .from("deposits")
      .select("*, profiles:profiles!deposits_user_id_fkey(id, email, user_custom_id, full_name)")
      .order("created_at", { ascending: false });

    if (!joinError && joinedData) {
      fetchedData = joinedData;
    } else {
      // 2. Fallback: select deposits directly and load corresponding profiles
      const { data: directData } = await supabase
        .from("deposits")
        .select("*")
        .order("created_at", { ascending: false });

      if (directData) {
        fetchedData = directData;
        const userIds = Array.from(new Set(directData.map((d: any) => d.user_id).filter(Boolean)));
        if (userIds.length > 0) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, email, user_custom_id, full_name")
            .in("id", userIds);

          const profMap = new Map((profs || []).map((p: any) => [p.id, p]));
          fetchedData.forEach((d: any) => {
            d.profiles = profMap.get(d.user_id) || null;
          });
        }
      }
    }

    if (fetchedData) {
      const normalized = fetchedData.map((d: any) => ({
        ...d,
        currency: d.currency || d.asset_code || "BTC",
        profiles: d.profiles || {
          id: d.user_id,
          email: d.user_email || "unknown@user.com",
          full_name: "Customer",
          user_custom_id: d.user_id ? String(d.user_id).slice(0, 8) : "N/A",
        },
      }));
      setDeposits(normalized);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchDeposits();
    fetchAdminSession();
  }, [fetchDeposits, fetchAdminSession]);

  async function handleAdjustBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!adminEmail) return alert("Admin session not found. Please log in.");
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return alert("Please enter a valid positive amount.");

    setActionLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_adjust_balance", {
        p_admin_email: adminEmail,
        p_target_user_id: targetUserId,
        p_currency: currency,
        p_action: action,
        p_amount: numAmount,
      });

      if (error) {
        throw new Error(error.message);
      }

      const note = reason.trim() || `Manual deposit reconciliation by ${adminEmail}`;

      // Insert transaction ledger record
      await supabase.from("wallet_transactions").insert({
        user_id: targetUserId,
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
        target_user_id: targetUserId,
        details: {
          currency,
          action,
          amount: numAmount,
          reason: note,
          new_balance: data?.new_balance,
          source: "deposits_page",
          date: new Date().toISOString(),
        },
      });

      alert(`Successfully adjusted balance! New ${currency} Balance: ${data?.new_balance ?? "Updated"}`);
      setShowAdjustModal(false);
      setAmount("");
      setReason("");
      fetchDeposits();
    } catch (err: any) {
      alert(`Adjustment error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  function openAdjustModalForDeposit(d: any) {
    setTargetUserId(d.user_id);
    setTargetUserInfo(d.profiles);
    setCurrency(d.currency || "BTC");
    setAction("add");
    setAmount("");
    setReason(`Reconciliation for deposit ${d.id.slice(0, 8)}...`);
    setShowAdjustModal(true);
  }

  // Powerful partial search filter across:
  // User's full name, Username, Email address, User ID (UUID and custom user ID), Deposit ID, Currency, Amount
  const filteredDeposits = deposits.filter((d) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;

    const fullName = d.profiles?.full_name?.toLowerCase() || "";
    const email = d.profiles?.email?.toLowerCase() || "";
    const customId = d.profiles?.user_custom_id?.toLowerCase() || "";
    const userId = (d.user_id || "").toLowerCase();
    const depositId = (d.id || "").toLowerCase();
    const curr = (d.currency || "").toLowerCase();
    const amt = String(d.amount || "");
    const status = (d.status || "").toLowerCase();

    return (
      fullName.includes(q) ||
      email.includes(q) ||
      customId.includes(q) ||
      userId.includes(q) ||
      depositId.includes(q) ||
      curr.includes(q) ||
      amt.includes(q) ||
      status.includes(q)
    );
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ArrowDownToLine className="w-6 h-6 text-emerald-500" />
            User Deposits & Ledger Reconciliation
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Search across user identities, verify blockchain deposits, and credit or adjust user balances on demand.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          {/* Powerful Search Bar */}
          <div className="relative flex-1 md:w-96">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, custom ID, UUID, deposit ID, amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <button
            onClick={() => {
              setTargetUserId("");
              setTargetUserInfo(null);
              setCurrency("BTC");
              setShowAdjustModal(true);
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
          >
            <Coins className="w-4 h-4" />
            Adjust Balance
          </button>

          <button
            onClick={() => fetchDeposits()}
            className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Deposits Table */}
      <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-900/90 shadow-md">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950 text-slate-400 uppercase text-xs border-b border-slate-800 font-semibold">
            <tr>
              <th className="p-3.5">Deposit ID</th>
              <th className="p-3.5">User Details</th>
              <th className="p-3.5">Currency</th>
              <th className="p-3.5">Amount</th>
              <th className="p-3.5">Status</th>
              <th className="p-3.5">Date</th>
              <th className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  <div className="flex justify-center items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                    Loading deposit records...
                  </div>
                </td>
              </tr>
            ) : filteredDeposits.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  No deposits found matching "{searchQuery}".
                </td>
              </tr>
            ) : (
              filteredDeposits.map((d) => (
                <tr key={d.id} className="hover:bg-slate-800/40 transition-colors">
                  {/* Deposit ID */}
                  <td className="p-3.5 font-mono text-xs text-slate-400">
                    <span title={d.id}>{d.id.slice(0, 10)}...</span>
                  </td>

                  {/* User Details with direct link to profile */}
                  <td className="p-3.5">
                    <Link 
                      href={`/adminnarayan/users/${d.user_id}`}
                      className="font-semibold text-white hover:text-blue-400 transition-colors flex items-center gap-1.5"
                    >
                      {d.profiles?.full_name || "User"}
                      <ExternalLink className="w-3 h-3 text-slate-500" />
                    </Link>
                    <p className="text-xs text-slate-400 font-mono">{d.profiles?.email}</p>
                    <p className="text-[11px] text-slate-500 font-mono">
                      CID: <span className="text-slate-300">{d.profiles?.user_custom_id || "N/A"}</span>
                    </p>
                  </td>

                  {/* Currency */}
                  <td className="p-3.5 font-bold uppercase text-white">
                    {d.currency}
                  </td>

                  {/* Amount */}
                  <td className="p-3.5 font-mono font-bold text-emerald-400">
                    {d.amount}
                  </td>

                  {/* Status */}
                  <td className="p-3.5">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        d.status === "completed" || d.status === "credited" || d.status === "confirmed"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : d.status === "refunded_below_minimum"
                          ? "bg-slate-800 text-slate-300 border border-slate-700"
                          : "bg-amber-950 text-amber-300 border border-amber-800"
                      }`}
                    >
                      {d.status === "completed" || d.status === "credited" ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Clock className="w-3 h-3 text-amber-400" />
                      )}
                      {d.status === "refunded_below_minimum"
                        ? "Refunded (Below Min)"
                        : d.status === "credited" || d.status === "completed"
                        ? "Completed"
                        : d.status}
                    </span>
                  </td>

                  {/* Date */}
                  <td className="p-3.5 text-xs text-slate-400 whitespace-nowrap">
                    {new Date(d.created_at).toLocaleString()}
                  </td>

                  {/* Actions */}
                  <td className="p-3.5 text-right whitespace-nowrap space-x-2">
                    <button
                      onClick={() => openAdjustModalForDeposit(d)}
                      className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-2.5 py-1.5 rounded-lg shadow-sm transition-colors"
                      title="Adjust this user's balance"
                    >
                      <Coins className="w-3 h-3" />
                      Adjust Balance
                    </button>
                    <Link
                      href={`/adminnarayan/users/${d.user_id}`}
                      className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs px-2.5 py-1.5 rounded-lg border border-slate-700 transition-colors"
                    >
                      Inspect User
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust Balance Modal */}
      {showAdjustModal && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Coins className="w-5 h-5 text-blue-400" />
                  Adjust User Balance
                </h2>
                {targetUserInfo && (
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Target: {targetUserInfo.email} ({targetUserInfo.user_custom_id})
                  </p>
                )}
              </div>
              <button onClick={() => setShowAdjustModal(false)} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Target User UUID</label>
                <input
                  type="text"
                  required
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  placeholder="e.g. c91f50ad-aa6a-46ca-961f-91ffd54e6ea7"
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 font-mono text-xs text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

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
                <label className="text-xs font-semibold text-slate-300">Adjustment Action</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setAction("add")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      action === "add"
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    + Add Funds (Credit)
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction("subtract")}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition-colors ${
                      action === "subtract"
                        ? "bg-rose-600 text-white border-rose-500 shadow-md"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:text-white"
                    }`}
                  >
                    - Subtract Funds (Debit)
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
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 font-mono text-sm text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Audit Reason / Reconciliation Note</label>
                <input
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Enter explicit reason for audit log..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "Applying..." : "Apply Balance Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
