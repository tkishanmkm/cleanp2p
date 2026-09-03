"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { 
  Search, 
  User, 
  ArrowLeftRight, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  FileText, 
  ShieldAlert, 
  Crown, 
  ExternalLink,
  RefreshCw,
  Coins,
  ChevronRight
} from "lucide-react";

export default function AdminGlobalSearchPage() {
  const supabase = createClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "users" | "admins" | "trades" | "deposits" | "withdrawals" | "ads" | "disputes">("all");

  const [users, setUsers] = useState<any[]>([]);
  const [trades, setTrades] = useState<any[]>([]);
  const [deposits, setDeposits] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [ads, setAds] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);

  const executeSearch = useCallback(async (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setUsers([]);
      setTrades([]);
      setDeposits([]);
      setWithdrawals([]);
      setAds([]);
      setDisputes([]);
      return;
    }

    setLoading(true);

    try {
      // 1. Search Users / Admins
      const { data: profs } = await supabase
        .from("profiles")
        .select("*")
        .or(`email.ilike.%${q}%,full_name.ilike.%${q}%,user_custom_id.ilike.%${q}%,id.ilike.%${q}%`)
        .limit(20);

      // 2. Search Trades
      const { data: trds } = await supabase
        .from("trades")
        .select(`
          *,
          buyer:profiles!trades_buyer_id_fkey(full_name, email, user_custom_id),
          seller:profiles!trades_seller_id_fkey(full_name, email, user_custom_id)
        `)
        .or(`id.ilike.%${q}%,status.ilike.%${q}%`)
        .limit(20);

      // 3. Search Deposits
      const { data: deps } = await supabase
        .from("deposits")
        .select("*")
        .or(`id.ilike.%${q}%,currency.ilike.%${q}%,status.ilike.%${q}%`)
        .limit(20);

      // 4. Search Withdrawals
      const { data: wds } = await supabase
        .from("withdrawals")
        .select("*")
        .or(`id.ilike.%${q}%,currency.ilike.%${q}%,address.ilike.%${q}%,status.ilike.%${q}%`)
        .limit(20);

      // 5. Search Ads
      const { data: adsList } = await supabase
        .from("ads")
        .select("*")
        .or(`id.ilike.%${q}%,cryptocurrency.ilike.%${q}%,fiat_currency.ilike.%${q}%`)
        .limit(20);

      // 6. Search Disputes
      const { data: disps } = await supabase
        .from("disputes")
        .select("*")
        .or(`id.ilike.%${q}%,trade_id.ilike.%${q}%,reason.ilike.%${q}%`)
        .limit(20);

      setUsers(profs || []);
      setTrades(trds || []);
      setDeposits(deps || []);
      setWithdrawals(wds || []);
      setAds(adsList || []);
      setDisputes(disps || []);
    } catch (err: any) {
      console.error("Global search error:", err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Debounced trigger or on form submit
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchTerm.trim().length >= 2) {
        executeSearch(searchTerm);
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [searchTerm, executeSearch]);

  const admins = users.filter((u) => u.role === "admin" || u.role === "super_admin" || u.is_admin_account);
  const regularUsers = users.filter((u) => !(u.role === "admin" || u.role === "super_admin" || u.is_admin_account));

  const totalResults = users.length + trades.length + deposits.length + withdrawals.length + ads.length + disputes.length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Search Header */}
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search className="w-6 h-6 text-purple-400" />
          Global Platform Search
        </h1>
        <p className="text-xs text-slate-400">
          Search across the entire platform database: Users, Admins, Trades, Escrows, Deposits, Withdrawals, Ads, and Disputes.
        </p>

        {/* Input */}
        <div className="relative max-w-3xl">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Type search query (Name, Email, Custom ID, UUID, Currency, Trade ID, Address)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-10 py-3.5 bg-slate-900 border border-slate-800 rounded-xl text-base text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 shadow-lg"
          />
          {loading && (
            <RefreshCw className="w-4 h-4 animate-spin absolute right-4 top-1/2 -translate-y-1/2 text-purple-400" />
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2 text-xs font-semibold">
        <button
          onClick={() => setActiveFilter("all")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "all"
              ? "bg-purple-600 text-white border-purple-500 shadow-md shadow-purple-600/30"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          All Results ({totalResults})
        </button>
        <button
          onClick={() => setActiveFilter("users")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "users"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Users ({regularUsers.length})
        </button>
        <button
          onClick={() => setActiveFilter("admins")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "admins"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Admins ({admins.length})
        </button>
        <button
          onClick={() => setActiveFilter("trades")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "trades"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Trades ({trades.length})
        </button>
        <button
          onClick={() => setActiveFilter("deposits")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "deposits"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Deposits ({deposits.length})
        </button>
        <button
          onClick={() => setActiveFilter("withdrawals")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "withdrawals"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Withdrawals ({withdrawals.length})
        </button>
        <button
          onClick={() => setActiveFilter("ads")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "ads"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Ads ({ads.length})
        </button>
        <button
          onClick={() => setActiveFilter("disputes")}
          className={`px-3 py-1.5 rounded-lg border transition-colors ${
            activeFilter === "disputes"
              ? "bg-purple-600 text-white border-purple-500"
              : "bg-slate-900 text-slate-400 border-slate-800 hover:text-white"
          }`}
        >
          Disputes ({disputes.length})
        </button>
      </div>

      {/* Results Container */}
      <div className="space-y-6">
        {/* Section: Admins */}
        {(activeFilter === "all" || activeFilter === "admins") && admins.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
              <Crown className="w-4 h-4 text-yellow-400" />
              Administrators ({admins.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {admins.map((admin) => (
                <Link
                  key={admin.id}
                  href={`/adminnarayan/users/${admin.id}`}
                  className="p-4 rounded-xl bg-purple-950/20 border border-purple-800/80 hover:bg-purple-900/30 transition-colors flex justify-between items-center group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
                      <Crown className="w-5 h-5 text-yellow-300" />
                    </div>
                    <div>
                      <p className="font-semibold text-white group-hover:text-purple-300 transition-colors">
                        {admin.full_name || "Admin Account"}
                      </p>
                      <p className="text-xs text-slate-400 font-mono">{admin.email}</p>
                      <p className="text-[11px] text-purple-400 font-mono">CID: {admin.user_custom_id} | UUID: {admin.id.slice(0, 8)}...</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-purple-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Section: Users */}
        {(activeFilter === "all" || activeFilter === "users") && regularUsers.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-blue-400 flex items-center gap-2">
              <User className="w-4 h-4" />
              Users ({regularUsers.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {regularUsers.map((user) => (
                <Link
                  key={user.id}
                  href={`/adminnarayan/users/${user.id}`}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800/80 transition-colors flex justify-between items-center group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-300 border border-slate-700 flex items-center justify-center font-bold text-sm">
                      {user.full_name?.[0]?.toUpperCase() || "U"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-white group-hover:text-blue-400 transition-colors">
                          {user.full_name || "Customer"}
                        </p>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          user.status === "Banned" 
                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                            : user.status === "Restricted"
                            ? "bg-amber-950 text-amber-300 border border-amber-800"
                            : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        }`}>
                          {user.status || "Active"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono">{user.email}</p>
                      <p className="text-[11px] text-slate-500 font-mono">CID: {user.user_custom_id} | UUID: {user.id.slice(0, 8)}...</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-blue-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Section: Trades */}
        {(activeFilter === "all" || activeFilter === "trades") && trades.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              Trades ({trades.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {trades.map((t) => (
                <Link
                  key={t.id}
                  href={`/adminnarayan/trades/${t.id}`}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800/80 transition-colors flex justify-between items-center group"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold text-emerald-400 group-hover:underline">
                        Trade #{t.id.slice(0, 8)}...
                      </p>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        t.status === "completed" 
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : t.status === "disputed"
                          ? "bg-rose-950 text-rose-300 border border-rose-800"
                          : "bg-amber-950 text-amber-300 border border-amber-800"
                      }`}>
                        {t.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1 font-semibold">
                      {t.amount} {t.crypto || t.crypto_currency} (${Number(t.fiat_amount || 0).toFixed(2)})
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                      Buyer: {t.buyer?.email || t.buyer_id?.slice(0, 8)} | Seller: {t.seller?.email || t.seller_id?.slice(0, 8)}
                    </p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Section: Deposits */}
        {(activeFilter === "all" || activeFilter === "deposits") && deposits.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
              <ArrowDownToLine className="w-4 h-4" />
              Deposits ({deposits.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {deposits.map((d) => (
                <div
                  key={d.id}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs font-bold text-white">Deposit {d.id.slice(0, 8)}...</p>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        {d.status}
                      </span>
                    </div>
                    <p className="text-sm font-mono font-bold text-emerald-400 mt-1">
                      {d.amount} {d.currency || d.asset_code}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">User UUID: {d.user_id?.slice(0, 8)}...</p>
                  </div>
                  <Link
                    href={`/adminnarayan/users/${d.user_id}`}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700"
                  >
                    User Profile
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section: Withdrawals */}
        {(activeFilter === "all" || activeFilter === "withdrawals") && withdrawals.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2">
              <ArrowUpFromLine className="w-4 h-4" />
              Withdrawals ({withdrawals.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {withdrawals.map((w) => (
                <div
                  key={w.id}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex justify-between items-center"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-xs font-bold text-white">WD #{w.id.slice(0, 8)}...</p>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-950 text-rose-300 border border-rose-800">
                        {w.status}
                      </span>
                    </div>
                    <p className="text-sm font-mono font-bold text-rose-400 mt-1">
                      {w.amount} {w.currency || w.asset_code}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono truncate max-w-xs">
                      Address: {w.address || w.destination_address}
                    </p>
                  </div>
                  <Link
                    href={`/adminnarayan/users/${w.user_id}`}
                    className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700"
                  >
                    User Profile
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Section: Disputes */}
        {(activeFilter === "all" || activeFilter === "disputes") && disputes.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" />
              Disputes ({disputes.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {disputes.map((disp) => (
                <Link
                  key={disp.id}
                  href={`/adminnarayan/trades/${disp.trade_id}`}
                  className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800/80 transition-colors flex justify-between items-center group"
                >
                  <div>
                    <p className="text-xs font-bold font-mono text-amber-400">Dispute #{disp.id.slice(0, 8)}...</p>
                    <p className="text-sm text-white font-semibold mt-0.5">Reason: {disp.reason || "Under review"}</p>
                    <p className="text-[11px] text-slate-400 font-mono">Linked Trade: {disp.trade_id}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-500 group-hover:text-amber-400" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* No results fallback */}
        {!loading && searchTerm.trim() && totalResults === 0 && (
          <div className="p-12 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800">
            <p className="text-base font-semibold text-slate-400">No records found matching "{searchTerm}".</p>
            <p className="text-xs text-slate-500 mt-1">Try searching by UUID, full email address, trade ID, or transaction hash.</p>
          </div>
        )}
      </div>
    </div>
  );
}
