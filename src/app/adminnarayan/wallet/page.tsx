"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function AdminMainWalletPage() {
  const supabase = createClient();
  const [wallets, setWallets] = useState<any[]>([]);
  const [queuedWithdrawals, setQueuedWithdrawals] = useState<any[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMainWallets();
    fetchQueuedWithdrawals();
    fetchAdminEmail();
  }, []);

  async function fetchAdminEmail() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) setAdminEmail(session.user.email);
  }

  async function fetchMainWallets() {
    const { data } = await supabase.from("admin_main_wallets").select("*");
    if (data && data.length > 0) {
      setWallets(data);
    } else {
      setWallets([
        { currency: "BTC", balance: "0.00000000" },
        { currency: "ETH", balance: "0.00000000" },
        { currency: "USDT", balance: "0.00000000" },
        { currency: "TRX", balance: "0.00000000" },
      ]);
    }
  }

  async function fetchQueuedWithdrawals() {
    setLoading(true);
    let items: any[] = [];
    const { data, error } = await supabase
      .from("withdrawals")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true });

    if (!error && data) {
      items = data;
      const userIds = Array.from(new Set(data.map((w: any) => w.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, email, user_custom_id")
          .in("id", userIds);

        const profMap = new Map((profs || []).map((p: any) => [p.id, p]));
        items.forEach((qw: any) => {
          qw.profiles = profMap.get(qw.user_id) || null;
        });
      }
    }

    const normalized = items.map((qw) => ({
      ...qw,
      currency: qw.currency || qw.asset_code || "USDT",
      address: qw.address || qw.destination_address || "—",
      profiles: qw.profiles || {
        email: "user@example.com",
        user_custom_id: qw.user_id ? String(qw.user_id).slice(0, 8) : "UNKNOWN",
      },
    }));

    setQueuedWithdrawals(normalized);
    setLoading(false);
  }

  async function handleReject(withdrawalId: string) {
    const reason = prompt("Enter reason for rejection:");
    if (!reason) return;

    const { error } = await supabase.rpc("admin_reject_queued_withdrawal", {
      p_admin_email: adminEmail,
      p_withdrawal_id: withdrawalId,
      p_reason: reason,
    });

    if (error) {
      alert(`Error rejecting withdrawal: ${error.message}`);
    } else {
      alert("Withdrawal rejected and funds restored to user wallet.");
      fetchQueuedWithdrawals();
      fetchMainWallets();
    }
  }

  return (
    <div className="p-6 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Platform Main Wallet & Queued Withdrawals</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {wallets.map((w) => (
          <div key={w.currency} className="border p-4 rounded-xl bg-white dark:bg-gray-800 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase">{w.currency} Main Balance</p>
            <p className="text-2xl font-bold mt-1">{w.balance}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold">Pending Withdrawal Queue</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading pending withdrawals...</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th className="p-3">User</th>
                  <th className="p-3">Currency</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Address</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {queuedWithdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-500">
                      No pending queued withdrawals found.
                    </td>
                  </tr>
                ) : (
                  queuedWithdrawals.map((qw) => (
                    <tr key={qw.id} className="border-t">
                      <td className="p-3 font-mono">{qw.profiles?.user_custom_id}</td>
                      <td className="p-3 uppercase">{qw.currency}</td>
                      <td className="p-3">{qw.amount}</td>
                      <td className="p-3 font-mono text-xs">{qw.address}</td>
                      <td className="p-3">
                        <button
                          onClick={() => handleReject(qw.id)}
                          className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded font-medium transition-colors"
                        >
                          Reject & Refund
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
