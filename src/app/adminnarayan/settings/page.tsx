import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { updateAppSettingsAction } from "./actions";
import { Settings, ShieldAlert, Percent, Lock, Save } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const adminSupabase = createAdminClient();

  // Fetch single row settings
  const { data: settings } = await adminSupabase
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Settings className="w-7 h-7 text-amber-400" />
          App Controls & Global Settings
        </h1>
        <p className="text-slate-400">
          Configure platform parameters, feature flags, fee schedules, and emergency locks.
        </p>
      </div>

      <form action={updateAppSettingsAction} className="space-y-6">
        {/* System Switches */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-red-400" /> System Status & Access Rules
            </CardTitle>
            <CardDescription className="text-slate-400">
              Control global user access and emergency platform locks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-slate-950 rounded-lg border border-slate-800">
              <div>
                <p className="text-sm font-medium text-white">Maintenance Mode</p>
                <p className="text-xs text-slate-400">
                  Blocks non-admin users from accessing trading features and profile dashboards.
                </p>
              </div>
              <input
                type="checkbox"
                name="maintenance_mode"
                defaultChecked={settings?.maintenance_mode ?? false}
                className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500"
              />
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-950 rounded-lg border border-slate-800">
              <div>
                <p className="text-sm font-medium text-white">Allow New Registrations</p>
                <p className="text-xs text-slate-400">
                  Enable or disable sign-ups for new platform users.
                </p>
              </div>
              <input
                type="checkbox"
                name="registrations_open"
                defaultChecked={settings?.registrations_open ?? true}
                className="w-5 h-5 rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
              />
            </div>
          </CardContent>
        </Card>

        {/* Financial Controls */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Percent className="w-5 h-5 text-emerald-400" /> Marketplace & Fee Rules
            </CardTitle>
            <CardDescription className="text-slate-400">
              Set default system commission fees and transaction thresholds.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 uppercase">
                Platform Fee Percentage (%)
              </label>
              <input
                type="number"
                step="0.01"
                name="platform_fee_percent"
                defaultValue={settings?.platform_fee_percent ?? 1.50}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 uppercase">
                Minimum Trade Amount ($)
              </label>
              <input
                type="number"
                step="0.01"
                name="min_trade_amount"
                defaultValue={settings?.min_trade_amount ?? 10.00}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg shadow-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </form>
    </div>
  );
}
