"use client";

import React, { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function BannedUserDashboard() {
  const supabase = createClient();
  const [profile, setProfile] = useState<any>(null);
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [withdrawalAddress, setWithdrawalAddress] = useState("");
  const [network, setNetwork] = useState("Mainnet");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadBannedUserData();
  }, []);

  async function loadBannedUserData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    setProfile(prof);

    const { data: wData } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .gt("balance", 0);

    if (wData) {
      setWallets(wData);
      if (wData.length > 0) setSelectedCurrency(wData[0].currency);
    }
    setLoading(false);
  }

  async function handleFinalWithdrawal(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSubmitting(true);

    const { data, error } = await supabase.rpc("execute_final_withdrawal", {
      p_user_id: profile.id,
      p_currency: selectedCurrency,
      p_network: network,
      p_address: withdrawalAddress,
      p_gas_fee: 0.0005,
    });

    if (error) {
      alert(`Withdrawal Failed: ${error.message}`);
    } else {
      alert(`Final withdrawal request submitted! Status: ${data?.status ?? "Queued"}`);
      setWithdrawalAddress("");
      loadBannedUserData();
    }
    setSubmitting(false);
  }

  async function handleExportCSV() {
    if (!profile) return;
    const { data: trades } = await supabase
      .from("trades")
      .select("*")
      .or(`buyer_id.eq.${profile.id},seller_id.eq.${profile.id}`);

    if (!trades || trades.length === 0) return alert("No trade records found.");

    const csvContent =
      "data:text/csv;charset=utf-8," +
      ["Trade ID,Type,Amount,Status,Created At"]
        .concat(
          trades.map(
            (t) =>
              `${t.id},${t.buyer_id === profile.id ? "BUY" : "SELL"},${t.amount},${t.status},${t.created_at}`
          )
        )
        .join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `trade_history_${profile.user_custom_id || profile.id}.csv`);
    document.body.appendChild(link);
    link.click();
  }

  if (loading) return <div className="p-6">Loading status...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-200 p-6 rounded-xl space-y-3">
        <h1 className="text-2xl font-bold">You are banned.</h1>
        <p className="text-sm">
          <strong>Reason for Ban:</strong> {profile?.ban_reason || "Violation of terms."}
        </p>
        <p className="text-xs">
          If you believe this action was taken in error, you can submit an appeal by opening a{" "}
          <a href="/support/new-ticket" className="underline font-semibold">
            Support Ticket
          </a>.
        </p>
        <button
          onClick={handleExportCSV}
          className="mt-2 bg-red-700 text-white text-xs px-3 py-1.5 rounded hover:bg-red-800"
        >
          Export Trade History (CSV)
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 border p-6 rounded-xl space-y-4">
        <h2 className="text-lg font-bold">Final Account Withdrawal</h2>

        {wallets.length === 0 ? (
          <p className="text-sm text-gray-500">
            No further withdrawal is available. All eligible cryptocurrency balances have been fully withdrawn.
          </p>
        ) : (
          <form onSubmit={handleFinalWithdrawal} className="space-y-4">
            <div>
              <label className="text-xs font-semibold">Select Cryptocurrency</label>
              <select
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                className="w-full p-2 border rounded mt-1 bg-transparent"
              >
                {wallets.map((w) => (
                  <option key={w.currency} value={w.currency} className="dark:bg-gray-800">
                    {w.currency} — Available Balance: {w.balance}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold">Withdrawal Network</label>
              <input
                type="text"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                className="w-full p-2 border rounded mt-1 bg-transparent"
                placeholder="e.g. TRC20 / ERC20"
              />
            </div>

            <div>
              <label className="text-xs font-semibold">Destination Wallet Address</label>
              <input
                type="text"
                required
                value={withdrawalAddress}
                onChange={(e) => setWithdrawalAddress(e.target.value)}
                className="w-full p-2 border rounded mt-1 font-mono text-sm bg-transparent"
              />
            </div>

            <p className="text-xs text-gray-500">
              * Note: You are required to withdraw your <strong>entire available balance</strong> for the selected asset in a single transaction.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-black dark:bg-white dark:text-black text-white p-2.5 rounded-lg font-medium hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors"
            >
              {submitting ? "Processing..." : "Withdraw Entire Asset Balance"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
