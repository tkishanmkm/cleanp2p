"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  User,
  ArrowLeftRight,
  ShieldAlert,
  ArrowDownToLine,
  ArrowUpFromLine,
  FileText,
  LifeBuoy,
  CreditCard,
  Loader2,
  X,
  CornerDownLeft,
} from "lucide-react";

interface SearchResults {
  users?: any[];
  trades?: any[];
  disputes?: any[];
  deposits?: any[];
  withdrawals?: any[];
  ads?: any[];
  tickets?: any[];
  transactions?: any[];
}

export function AdminGlobalSearch() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults(null);
    }
  }, [isOpen]);

  const performSearch = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim() || searchTerm.trim().length < 2) {
      setResults(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(searchTerm.trim())}`);
      const data = await res.json();
      if (data.success && data.results) {
        setResults(data.results);
      } else {
        setResults({});
      }
    } catch (err) {
      console.error("Global search error:", err);
      setResults({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch(query);
      } else {
        setResults(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const handleSelect = (url: string) => {
    setIsOpen(false);
    router.push(url);
  };

  const totalResults = results
    ? (results.users?.length || 0) +
      (results.trades?.length || 0) +
      (results.disputes?.length || 0) +
      (results.deposits?.length || 0) +
      (results.withdrawals?.length || 0) +
      (results.ads?.length || 0) +
      (results.tickets?.length || 0) +
      (results.transactions?.length || 0)
    : 0;

  return (
    <>
      {/* Search Trigger Button */}
      <button
        id="admin-global-search-trigger"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 text-xs transition-all w-full max-w-xs md:max-w-sm lg:max-w-md"
      >
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className="truncate flex-1 text-left">Search users, trades, deposits, tickets...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-400 border border-slate-700 rounded">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Global Search Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-20 px-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden text-slate-100 flex flex-col max-h-[80vh]"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950">
              <Search className="w-5 h-5 text-blue-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type name, email, custom ID, UUID, trade ID, deposit ID, TXID..."
                className="w-full bg-transparent border-none text-white placeholder-slate-500 focus:outline-none text-sm"
              />
              {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0" />}
              {query && !loading && (
                <button
                  onClick={() => {
                    setQuery("");
                    setResults(null);
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <kbd
                onClick={() => setIsOpen(false)}
                className="cursor-pointer px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-400 border border-slate-700 rounded hover:bg-slate-700"
              >
                ESC
              </kbd>
            </div>

            {/* Results Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 divide-y divide-slate-800/60">
              {query.trim().length < 2 && (
                <div className="text-center py-10 text-slate-500 text-xs">
                  Type at least 2 characters to search across all platform entities...
                </div>
              )}

              {query.trim().length >= 2 && !loading && totalResults === 0 && (
                <div className="text-center py-10 space-y-1">
                  <p className="text-sm font-semibold text-slate-300">No matching records found</p>
                  <p className="text-xs text-slate-500">
                    No results for &quot;{query}&quot; in users, trades, deposits, withdrawals, ads, or tickets.
                  </p>
                </div>
              )}

              {/* Users */}
              {results?.users && results.users.length > 0 && (
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-blue-400 tracking-wider uppercase flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> Users ({results.users.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.users.map((u) => (
                      <div
                        key={u.id}
                        onClick={() => handleSelect(`/adminnarayan/users/${u.id}`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-blue-300 truncate">
                            {u.full_name || u.email}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            {u.email} • ID: {u.user_custom_id || u.id.slice(0, 8)} • Role: {u.role || "user"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          {u.status || "Active"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trades */}
              {results?.trades && results.trades.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-amber-400 tracking-wider uppercase flex items-center gap-1.5">
                      <ArrowLeftRight className="w-3.5 h-3.5" /> P2P Trades ({results.trades.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.trades.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleSelect(`/adminnarayan/trades/${t.id}`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-amber-300 truncate">
                            Trade #{t.id.slice(0, 8)} • {t.amount} {t.crypto_currency || t.asset_symbol}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            Fiat: {t.fiat_amount} {t.fiat_currency} • Method: {t.payment_method || "Direct"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-amber-950 text-amber-300 border border-amber-800">
                          {t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disputes */}
              {results?.disputes && results.disputes.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-rose-400 tracking-wider uppercase flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" /> Disputes ({results.disputes.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.disputes.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => handleSelect(`/adminnarayan/disputes/${d.trade_id || d.id}`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-rose-300 truncate">
                            Dispute on Trade #{String(d.trade_id || d.id).slice(0, 8)}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            Reason: {d.reason || "Escrow conflict"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-rose-950 text-rose-300 border border-rose-800">
                          {d.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Deposits */}
              {results?.deposits && results.deposits.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-emerald-400 tracking-wider uppercase flex items-center gap-1.5">
                      <ArrowDownToLine className="w-3.5 h-3.5" /> Deposits ({results.deposits.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.deposits.map((dep) => (
                      <div
                        key={dep.id}
                        onClick={() => handleSelect(`/adminnarayan/deposits`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-emerald-300 truncate">
                            Deposit: {dep.amount} {dep.currency || dep.asset_symbol}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            ID: {dep.id.slice(0, 8)}... • TXID: {dep.txid || dep.transaction_hash || "Internal"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-950 text-emerald-300 border border-emerald-800">
                          {dep.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Withdrawals */}
              {results?.withdrawals && results.withdrawals.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-purple-400 tracking-wider uppercase flex items-center gap-1.5">
                      <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdrawals ({results.withdrawals.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.withdrawals.map((w) => (
                      <div
                        key={w.id}
                        onClick={() => handleSelect(`/adminnarayan/withdrawals`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-purple-300 truncate">
                            Withdrawal: {w.amount} {w.currency || w.asset_symbol}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            To: {w.destination_address ? `${w.destination_address.slice(0, 16)}...` : "Internal"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-950 text-purple-300 border border-purple-800">
                          {w.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Support Tickets */}
              {results?.tickets && results.tickets.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-cyan-400 tracking-wider uppercase flex items-center gap-1.5">
                      <LifeBuoy className="w-3.5 h-3.5" /> Support Tickets ({results.tickets.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.tickets.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleSelect(`/adminnarayan/support`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-cyan-300 truncate">
                            {s.subject || "Support Ticket"}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            Ticket #{s.id.slice(0, 8)} • Priority: {s.priority || "Normal"}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-cyan-950 text-cyan-300 border border-cyan-800">
                          {s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ads */}
              {results?.ads && results.ads.length > 0 && (
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-indigo-400 tracking-wider uppercase flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> P2P Ads ({results.ads.length})
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {results.ads.map((ad) => (
                      <div
                        key={ad.id}
                        onClick={() => handleSelect(`/adminnarayan/ads`)}
                        className="p-2.5 rounded-lg bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 cursor-pointer flex items-center justify-between group transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white group-hover:text-indigo-300 truncate">
                            {ad.type?.toUpperCase()} {ad.cryptocurrency || ad.currency} @ {ad.price} {ad.fiat_currency}
                          </p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">
                            Ad ID: {ad.id.slice(0, 8)} • Payment: {ad.payment_method}
                          </p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          {ad.status || "active"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1">
                <CornerDownLeft className="w-3 h-3 text-slate-500" />
                Press <kbd className="px-1 bg-slate-900 border border-slate-800 rounded font-mono">Enter</kbd> to select
              </span>
              <span>Search across users, trades, deposits, tickets</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
