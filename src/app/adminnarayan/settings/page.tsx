import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettings } from "@/lib/platform-settings";
import PlatformSettingsSwitchboard from "./PlatformSettingsSwitchboard";

export const dynamic = "force-dynamic";

function numericSetting(rows: Array<{ key: string; value: string }> | null, key: string, fallback: number): number {
  const raw = rows?.find((row) => row.key === key)?.value;
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export default async function AdminSettingsPage() {
  const adminSupabase = createAdminClient();

  const [appSettingsResult, withdrawalResult] = await Promise.all([
    adminSupabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["platform_fee_percent", "escrow_fee_percent", "min_trade_amount"]),
    adminSupabase
      .from("platform_settings")
      .select("max_single_withdrawal_usd, withdrawal_approval_threshold_usd, daily_withdrawal_limit_usd, password_change_withdrawal_hold_hours, withdrawal_fee_multiplier")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (appSettingsResult.error) {
    throw new Error("Unable to load marketplace fee settings: " + appSettingsResult.error.message);
  }
  if (withdrawalResult.error) {
    throw new Error("Unable to load withdrawal governance settings: " + withdrawalResult.error.message);
  }

  const platformSettings = await getPlatformSettings(true);
  const appRows = (appSettingsResult.data || []) as Array<{ key: string; value: string }>;
  const withdrawalGovernance = withdrawalResult.data;

  return (
    <PlatformSettingsSwitchboard
      initialSettings={platformSettings}
      appSettings={{
        platform_fee_percent: numericSetting(appRows, "platform_fee_percent", 1.5),
        escrow_fee_percent: numericSetting(appRows, "escrow_fee_percent", 1.5),
        min_trade_amount: numericSetting(appRows, "min_trade_amount", 10.0),
      }}
      withdrawalGovernance={{
        max_single_withdrawal_usd: Number(withdrawalGovernance?.max_single_withdrawal_usd ?? 4000.0),
        withdrawal_approval_threshold_usd: Number(withdrawalGovernance?.withdrawal_approval_threshold_usd ?? 2000.0),
        daily_withdrawal_limit_usd: Number(withdrawalGovernance?.daily_withdrawal_limit_usd ?? 10000.0),
        password_change_withdrawal_hold_hours: Number(withdrawalGovernance?.password_change_withdrawal_hold_hours ?? 24.0),
        withdrawal_fee_multiplier: Number(withdrawalGovernance?.withdrawal_fee_multiplier ?? 2.0),
      }}
    />
  );
}
