import { createAdminClient } from "@/lib/supabase/admin";
import { getPlatformSettings } from "@/lib/platform-settings";
import PlatformSettingsSwitchboard from "./PlatformSettingsSwitchboard";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const adminSupabase = createAdminClient();

  // Fetch single row settings for fees
  const { data: settings } = await adminSupabase
    .from("app_settings")
    .select("platform_fee_percent, min_trade_amount")
    .eq("id", 1)
    .maybeSingle();

  // Fetch canonical withdrawal limits & governance settings
  const { data: withdrawalGovernance } = await adminSupabase
    .from("platform_settings")
    .select("max_single_withdrawal_usd, daily_withdrawal_limit_usd, withdrawal_approval_threshold_usd, password_change_withdrawal_hold_hours")
    .eq("id", 1)
    .maybeSingle();

  // Fetch canonical global controls from system_settings
  const platformSettings = await getPlatformSettings(true);

  return (
    <PlatformSettingsSwitchboard
      initialSettings={platformSettings}
      appSettings={{
        platform_fee_percent: settings?.platform_fee_percent ?? 1.5,
        min_trade_amount: settings?.min_trade_amount ?? 10.0,
      }}
      withdrawalGovernance={{
        max_single_withdrawal_usd: Number(withdrawalGovernance?.max_single_withdrawal_usd || 4000.0),
        withdrawal_approval_threshold_usd: Number(withdrawalGovernance?.withdrawal_approval_threshold_usd || 2000.0),
        daily_withdrawal_limit_usd: Number(withdrawalGovernance?.daily_withdrawal_limit_usd || 10000.0),
        password_change_withdrawal_hold_hours: Number(withdrawalGovernance?.password_change_withdrawal_hold_hours || 24.0),
      }}
    />
  );
}
