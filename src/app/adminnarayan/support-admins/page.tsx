"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, ShieldAlert, Users, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";

type SupportGrant = {
  user_id: string;
  is_enabled: boolean;
  emergency_uses_granted: number;
  emergency_uses_consumed: number;
  emergency_uses_remaining: number;
  granted_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
};

type SupportActivity = {
  id: string;
  support_admin_id: string;
  emergency_session_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  details: Record<string, unknown>;
  created_at: string;
};

export default function SupportAdminsPage() {
  const [grants, setGrants] = useState<SupportGrant[]>([]);
  const [activity, setActivity] = useState<SupportActivity[]>([]);
  const [userId, setUserId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [addEmergencyUses, setAddEmergencyUses] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/support-admins", { cache: "no-store" });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Could not load support-admin records.");
      }
      setGrants(Array.isArray(result.supportAdmins) ? result.supportAdmins : []);
      setActivity(Array.isArray(result.activity) ? result.activity : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load support-admin records.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/support-admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), enabled, addEmergencyUses }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || "Support-admin update failed.");
      }
      setMessage("Support-admin permissions updated and audited.");
      setUserId("");
      setAddEmergencyUses(0);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Support-admin update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Support Admins</h1>
          <p className="mt-1 text-sm text-slate-400">Grant view-only access and allocate one-time, three-hour emergency sessions.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
        </Button>
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-sky-400" />
          <h2 className="font-semibold text-white">Grant or update support access</h2>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm text-slate-300 xl:col-span-2">
            User UUID
            <input required value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="UUID from the user's profile" className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <label className="block text-sm text-slate-300">
            Additional emergency uses
            <input required type="number" min={0} max={1000} step={1} value={addEmergencyUses} onChange={(e) => setAddEmergencyUses(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-300">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
            Support access enabled
          </label>
          <div className="md:col-span-2 xl:col-span-4">
            <Button type="submit" disabled={saving || !userId.trim()}>{saving ? "Saving…" : "Save Support Permissions"}</Button>
          </div>
        </form>
        <p className="mt-3 text-xs text-slate-500">Setting additional uses to zero does not replenish an exhausted allowance. Each successful activation consumes one use. Disabling access prevents future support access.</p>
      </section>

      {error && <div role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">{error}</div>}
      {message && <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">{message}</div>}

      <section className="rounded-xl border border-slate-800 bg-slate-900/70">
        <div className="flex items-center gap-2 border-b border-slate-800 p-4">
          <Users className="h-5 w-5 text-sky-400" />
          <h2 className="font-semibold text-white">Configured support admins</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400">
              <tr><th className="p-3">User UUID</th><th className="p-3">Access</th><th className="p-3">Uses granted</th><th className="p-3">Consumed</th><th className="p-3">Remaining</th><th className="p-3">Updated</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {grants.map((grant) => (
                <tr key={grant.user_id} className="text-slate-200">
                  <td className="break-all p-3 font-mono text-xs">{grant.user_id}</td>
                  <td className="p-3"><span className={grant.is_enabled ? "rounded-full bg-emerald-950 px-2 py-1 text-xs text-emerald-300" : "rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400"}>{grant.is_enabled ? "Enabled" : "Disabled"}</span></td>
                  <td className="p-3">{grant.emergency_uses_granted}</td><td className="p-3">{grant.emergency_uses_consumed}</td><td className="p-3 font-semibold">{grant.emergency_uses_remaining}</td><td className="p-3 text-xs text-slate-400">{new Date(grant.updated_at).toLocaleString()}</td>
                </tr>
              ))}
              {!loading && grants.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No support admins configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70">
        <div className="flex items-center gap-2 border-b border-slate-800 p-4">
          <Clock3 className="h-5 w-5 text-amber-400" />
          <h2 className="font-semibold text-white">Recent emergency activity</h2>
          <span className="ml-auto text-xs text-slate-500">Latest 100 records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400">
              <tr><th className="p-3">Time</th><th className="p-3">Support admin</th><th className="p-3">Action</th><th className="p-3">Target</th><th className="p-3">Outcome</th><th className="p-3">Session</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {activity.map((item) => (
                <tr key={item.id} className="text-slate-200">
                  <td className="whitespace-nowrap p-3 text-xs text-slate-400">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="break-all p-3 font-mono text-xs">{item.support_admin_id}</td>
                  <td className="p-3">{item.action}</td>
                  <td className="break-all p-3 text-xs">{item.target_id || "—"}</td>
                  <td className="p-3"><span className="rounded-full bg-slate-800 px-2 py-1 text-xs">{item.outcome}</span></td>
                  <td className="break-all p-3 font-mono text-xs">{item.emergency_session_id || "—"}</td>
                </tr>
              ))}
              {!loading && activity.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No emergency activity recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-800 p-3 text-xs text-slate-500"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />Activity records are append-only from the application's support-admin flow. Requests are logged as attempted before the protected action executes.</div>
      </section>
    </div>
  );
}
