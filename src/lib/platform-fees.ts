import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

export interface PlatformFeeSettings {
  platformFeePercent: number;
  escrowFeePercent: number;
  minTradeAmount: number;
}

function parseSetting(
  rows: Array<{ key: string; value: string }> | null,
  key: string,
  minimum: number,
  maximum: number
): number {
  const raw = rows?.find((row) => row.key === key)?.value;
  const value = raw === undefined || raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error("Platform fee configuration is missing or invalid: " + key);
  }
  return value;
}

/**
 * Loads the single canonical fee configuration from public.app_settings.
 * Never substitutes an unverified default for a missing/corrupt financial setting.
 */
export async function getPlatformFeeSettings(): Promise<PlatformFeeSettings> {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["platform_fee_percent", "escrow_fee_percent", "min_trade_amount"]);

  if (error || !Array.isArray(data)) {
    throw new Error("Unable to verify current platform fees: " + (error?.message || "empty response"));
  }

  return {
    platformFeePercent: parseSetting(data, "platform_fee_percent", 0, 10),
    escrowFeePercent: parseSetting(data, "escrow_fee_percent", 0, 10),
    minTradeAmount: parseSetting(data, "min_trade_amount", 0.01, 1000000),
  };
}
