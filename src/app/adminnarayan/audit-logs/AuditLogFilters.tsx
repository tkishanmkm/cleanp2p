"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, RotateCcw, Filter, Loader2 } from "lucide-react";

const ACTION_OPTIONS = [
  { label: "All Actions", value: "ALL" },
  { label: "Update Role", value: "UPDATE_USER_ROLE" },
  { label: "Toggle Suspension", value: "TOGGLE_USER_SUSPENSION" },
  { label: "Update App Settings", value: "UPDATE_APP_SETTINGS" },
  { label: "Resolve Escrow", value: "RESOLVE_TRADE_ESCROW" },
];

export function AuditLogFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [action, setAction] = useState(searchParams.get("action") || "ALL");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") || "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") || "");

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (action && action !== "ALL") params.set("action", action);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const resetFilters = () => {
    setSearch("");
    setAction("ALL");
    setStartDate("");
    setEndDate("");
    startTransition(() => {
      router.push(pathname);
    });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        {/* Search Input */}
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">Keyword / ID</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-500" />
            <Input
              type="text"
              placeholder="Search target ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-slate-950 border-slate-800 text-slate-200 text-sm focus:border-indigo-500"
            />
          </div>
        </div>

        {/* Action Type Dropdown */}
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">Action Type</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-3 py-1 text-sm text-slate-200 shadow-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Start Date */}
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">From Date</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-950 border-slate-800 text-slate-200 text-sm focus:border-indigo-500"
          />
        </div>

        {/* End Date */}
        <div>
          <label className="text-xs font-medium text-slate-400 mb-1 block">To Date</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-950 border-slate-800 text-slate-200 text-sm focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
        <Button
          variant="ghost"
          size="sm"
          onClick={resetFilters}
          disabled={isPending}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
          Reset
        </Button>

        <Button
          size="sm"
          onClick={applyFilters}
          disabled={isPending}
          className="bg-indigo-600 text-white hover:bg-indigo-500"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
          ) : (
            <Filter className="w-3.5 h-3.5 mr-1.5" />
          )}
          Apply Filters
        </Button>
      </div>
    </div>
  );
}
