"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 
  ShieldCheck, 
  User, 
  Search, 
  SlidersHorizontal, 
  UserCheck, 
  UserX, 
  AlertTriangle, 
  Coins, 
  ExternalLink,
  Crown,
  RefreshCw,
  Clock
} from "lucide-react";

export default function AdminUsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  // Modal State for Balance Adjustment & Status/Role Changes
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [modalType, setModalType] = useState<"balance" | "status" | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Balance form state
  const [currency, setCurrency] = useState("BTC");
  const [action, setAction] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [balanceReason, setBalanceReason] = useState("");

  // Status/Role form state
  const [targetStatus, setTargetStatus] = useState<"Active" | "Restricted" | "Suspended" | "Banned">("Active");
  const [statusReason, setStatusReason] = useState("");

  const fetchAdminSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) {
      setAdminEmail(session.user.email);
    }
  }, [supabase]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data.success && data.users) {
        setUsers(data.users);
        setLoading(false);
        return;
      }
    } catch (apiErr) {
      console.warn("API users fetch fallback to client Supabase:", apiErr);
    }

    // Client fallback
    const { data: profs, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching profiles:", error);
      setLoading(false);
      return;
    }

    const { data: wData } = await supabase.from("wallets").select("*");

    const walletMap = new Map<string, any[]>();
    (wData || []).forEach((w: any) => {
      if (!walletMap.has(w.user_id)) walletMap.set(w.user_id, []);
      walletMap.get(w.user_id)!.push(w);
    });

    const combined = (profs || []).map((p: any) => ({
      ...p,
      status: p.status || (p.is_banned ? "Banned" : p.is_suspended ? "Suspended" : "Active"),
      wallets: walletMap.get(p.id) || [],
    }));

    setUsers(combined);
    setLoading(false);
  }, [searchQuery, supabase]);

  useEffect(() => {
    fetchAdminSession();
    fetchUsers();
  }, [fetchAdminSession, fetchUsers]);

  // Adjust Balance Handler
  async function handleAdjustBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser) return;

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      alert("Please enter a valid positive crypto amount.");
      return;
    }

    setActionLoading(true);

    try {
      const res = await fetch("/api/admin/adjust-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
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

      alert(`Balance successfully adjusted! New ${currency} Balance: ${data.new_balance ?? "Updated"}`);
      closeModal();
      fetchUsers();
    } catch (err: any) {
      alert(`Adjustment error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  // Update Status or Role Handler
  async function handleUpdateStatus(newStatus: "Active" | "Restricted" | "Suspended" | "Banned", reason: string) {
    if (!selectedUser) return;
    setActionLoading(true);

    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_status",
          status: newStatus,
          reason: reason || "Admin updated status",
          adminEmail,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to update user status.");
      }

      alert(`User status successfully updated to ${newStatus}`);
      closeModal();
      fetchUsers();
    } catch (err: any) {
      alert(`Failed to update user status: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  // Toggle Admin Role Handler
  async function handleToggleRole() {
    if (!selectedUser) return;
    const isCurrentlyAdmin = selectedUser.role === "admin" || selectedUser.is_admin_account === true;
    const newRole = isCurrentlyAdmin ? "user" : "admin";

    const confirmMsg = isCurrentlyAdmin
      ? `Revoke Admin privileges from ${selectedUser.email || selectedUser.full_name}?`
      : `Promote ${selectedUser.email || selectedUser.full_name} to Administrator?`;

    if (!confirm(confirmMsg)) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}`, {
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

      alert(`Successfully updated role to ${newRole.toUpperCase()}`);
      closeModal();
      fetchUsers();
    } catch (err: any) {
      alert(`Role change failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  function closeModal() {
    setSelectedUser(null);
    setModalType(null);
    setAmount("");
    setBalanceReason("");
    setStatusReason("");
  }

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.email?.toLowerCase().includes(q) ||
      u.full_name?.toLowerCase().includes(q) ||
      u.user_custom_id?.toLowerCase().includes(q) ||
      u.id?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q) ||
      u.status?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <User className="w-6 h-6 text-blue-500" />
            User & Admin Management
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Supervise user credentials, enforce account status restrictions, adjust cryptocurrency balances, and inspect complete activity.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name, email, custom ID, or UUID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            onClick={() => fetchUsers()}
            title="Refresh Users"
            className="p-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="overflow-x-auto border border-slate-800 rounded-xl bg-slate-900/90 shadow-md">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950 text-slate-400 uppercase text-xs border-b border-slate-800 font-semibold">
            <tr>
              <th className="p-3.5">User ID / Name</th>
              <th className="p-3.5">Role</th>
              <th className="p-3.5">Status</th>
              <th className="p-3.5">Wallet Balances</th>
              <th className="p-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-400">
                  <div className="flex justify-center items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
                    Loading platform user records...
                  </div>
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  No users matching query "{searchQuery}".
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isAdmin = u.role === "admin" || u.role === "super_admin" || u.is_admin_account === true;
                const userStatus = u.status || "Active";

                return (
                  <tr 
                    key={u.id} 
                    className={`hover:bg-slate-800/50 transition-colors ${
                      isAdmin ? "bg-purple-950/20 border-l-4 border-l-purple-500" : ""
                    }`}
                  >
                    {/* User ID / Name */}
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${
                          isAdmin 
                            ? "bg-purple-600 text-white shadow-md shadow-purple-600/30 ring-2 ring-purple-400/50" 
                            : "bg-slate-800 text-slate-300 border border-slate-700"
                        }`}>
                          {isAdmin ? <Crown className="w-4 h-4" /> : (u.full_name?.[0]?.toUpperCase() || "U")}
                        </div>
                        <div>
                          <Link 
                            href={`/adminnarayan/users/${u.id}`}
                            className="font-semibold text-white hover:text-blue-400 transition-colors flex items-center gap-1.5"
                          >
                            {u.full_name || "Unnamed User"}
                            <ExternalLink className="w-3 h-3 text-slate-500" />
                          </Link>
                          <p className="text-xs text-slate-400 font-mono">{u.email || "No email"}</p>
                          <p className="text-[11px] text-slate-500 font-mono">
                            CID: <span className="text-slate-300">{u.user_custom_id || "N/A"}</span> | UUID: {u.id.slice(0, 8)}...
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Role Badge (Clearly Distinct Style) */}
                    <td className="p-3.5">
                      {isAdmin ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-600/30 text-purple-200 border border-purple-500 shadow-sm">
                          <Crown className="w-3.5 h-3.5 text-yellow-400" />
                          ADMIN
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          <User className="w-3 h-3 text-slate-400" />
                          User
                        </span>
                      )}
                    </td>

                    {/* Status Badge */}
                    <td className="p-3.5">
                      {userStatus === "Active" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
                          <UserCheck className="w-3 h-3 text-emerald-400" />
                          Active
                        </span>
                      )}
                      {userStatus === "Restricted" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800" title={u.ban_reason}>
                          <AlertTriangle className="w-3 h-3 text-amber-400" />
                          Restricted
                        </span>
                      )}
                      {userStatus === "Suspended" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-950 text-orange-300 border border-orange-800" title={u.ban_reason}>
                          <Clock className="w-3 h-3 text-orange-400" />
                          Suspended
                        </span>
                      )}
                      {userStatus === "Banned" && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-rose-950 text-rose-300 border border-rose-800" title={u.ban_reason}>
                          <UserX className="w-3 h-3 text-rose-400" />
                          Banned
                        </span>
                      )}
                      {u.ban_reason && (
                        <p className="text-[10px] text-slate-400 italic mt-0.5 truncate max-w-xs">
                          {u.ban_reason}
                        </p>
                      )}
                    </td>

                    {/* Wallet Balances */}
                    <td className="p-3.5">
                      {u.wallets && u.wallets.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 max-w-xs font-mono text-xs">
                          {u.wallets.map((w: any) => (
                            <span 
                              key={w.currency} 
                              className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/80 text-slate-200"
                            >
                              <strong className="text-blue-400">{w.currency}:</strong> {Number(w.balance).toFixed(4)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 font-mono">0.0000</span>
                      )}
                    </td>

                    {/* Action Buttons (High Contrast & Visible) */}
                    <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => {
                          setSelectedUser(u);
                          setModalType("balance");
                        }}
                        className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs px-3 py-1.5 rounded-lg shadow-sm transition-colors"
                      >
                        <Coins className="w-3.5 h-3.5" />
                        Adjust Balance
                      </button>

                      <button
                        onClick={() => {
                          setSelectedUser(u);
                          setTargetStatus(u.status || "Active");
                          setStatusReason(u.ban_reason || "");
                          setModalType("status");
                        }}
                        className="inline-flex items-center gap-1 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs px-3 py-1.5 rounded-lg border border-slate-700 shadow-sm transition-colors"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                        Status / Role
                      </button>

                      <Link
                        href={`/adminnarayan/users/${u.id}`}
                        className="inline-flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white text-xs px-2.5 py-1.5 rounded-lg border border-slate-800 transition-colors"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Adjust Balance Modal */}
      {selectedUser && modalType === "balance" && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <Coins className="w-5 h-5 text-blue-400" />
                  Adjust Wallet Balance
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Target: {selectedUser.email || selectedUser.full_name} ({selectedUser.user_custom_id || selectedUser.id.slice(0, 8)})
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <form onSubmit={handleAdjustBalance} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-300">Select Cryptocurrency</label>
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
                        ? "bg-emerald-600 text-white border-emerald-500 shadow-md shadow-emerald-600/30"
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
                        ? "bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-600/30"
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
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm font-mono text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300">Audit Reason / Note</label>
                <input
                  type="text"
                  required
                  value={balanceReason}
                  onChange={(e) => setBalanceReason(e.target.value)}
                  placeholder="e.g., Reconciliation discrepancy / deposit credit"
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <p>• Admin Performing: <span className="text-white font-mono">{adminEmail || "Current Admin"}</span></p>
                <p>• Action will immediately update the user's live balance and record a ledger transaction.</p>
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {actionLoading ? "Processing..." : "Confirm Balance Adjustment"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Status & Role Modal */}
      {selectedUser && modalType === "status" && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 text-white p-6 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
            <div className="flex justify-between items-start border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <SlidersHorizontal className="w-5 h-5 text-blue-400" />
                  Manage User Status & Role
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  {selectedUser.email || selectedUser.full_name} ({selectedUser.user_custom_id})
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-white text-sm">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Status Select */}
              <div>
                <label className="text-xs font-semibold text-slate-300">Account Status</label>
                <select
                  value={targetStatus}
                  onChange={(e) => setTargetStatus(e.target.value as any)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500 font-semibold"
                >
                  <option value="Active">Active — Normal Account Privileges</option>
                  <option value="Restricted">Restricted — Trade and Ads Restrictions</option>
                  <option value="Suspended">Suspended — Temporary Account Hold</option>
                  <option value="Banned">Banned — Account Terminated / Final Withdrawal</option>
                </select>
              </div>

              {/* Reason input for non-active */}
              {targetStatus !== "Active" && (
                <div>
                  <label className="text-xs font-semibold text-slate-300">
                    Reason for {targetStatus} Status <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                    placeholder={`State specific policy violation or cause for ${targetStatus}...`}
                    className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-lg mt-1 text-sm text-white focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <button
                onClick={() => handleUpdateStatus(targetStatus, statusReason)}
                disabled={actionLoading || (targetStatus !== "Active" && !statusReason.trim())}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {actionLoading ? "Updating..." : `Apply Status: ${targetStatus}`}
              </button>

              {/* Quick Actions / Role Toggle */}
              <div className="pt-4 border-t border-slate-800 space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Administrative Privilege
                </p>
                <button
                  onClick={handleToggleRole}
                  disabled={actionLoading}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
                    selectedUser.role === "admin" || selectedUser.is_admin_account
                      ? "bg-rose-950 text-rose-300 border border-rose-800 hover:bg-rose-900"
                      : "bg-purple-600 text-white hover:bg-purple-500 shadow-md shadow-purple-600/30"
                  }`}
                >
                  <Crown className="w-4 h-4" />
                  {selectedUser.role === "admin" || selectedUser.is_admin_account
                    ? "Remove Administrator Role"
                    : "Promote to Administrator"}
                </button>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-1.5 text-xs text-slate-400 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
