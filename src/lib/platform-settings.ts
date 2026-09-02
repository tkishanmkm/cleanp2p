import fs from "fs";
import path from "path";

export interface PlatformSettings {
  tradingEnabled: boolean;
  maintenanceMode: boolean;
  minTradeUsd: number;
  maxTradeUsd: number;
  escrowFeePercent: number;
  defaultPaymentWindowMinutes: number;
  allowNewRegistrations: boolean;
  requireKycForAds: boolean;
  maxActiveTradesPerUser: number;
  autoCancelUnpaidTrades: boolean;
  disputeGracePeriodMinutes: number;
  supportEmail: string;
  platformAnnouncement: string;
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  tradingEnabled: true,
  maintenanceMode: false,
  minTradeUsd: 10,
  maxTradeUsd: 15000,
  escrowFeePercent: 1.0,
  defaultPaymentWindowMinutes: 30,
  allowNewRegistrations: true,
  requireKycForAds: false,
  maxActiveTradesPerUser: 5,
  autoCancelUnpaidTrades: true,
  disputeGracePeriodMinutes: 15,
  supportEmail: "support@paxones.com",
  platformAnnouncement: "",
  updatedAt: new Date().toISOString(),
  updatedBy: "System Default",
};

const SETTINGS_FILE_PATH = path.join(process.cwd(), "src", "data", "platform-settings.json");

export async function getPlatformSettings(): Promise<PlatformSettings> {
  try {
    if (fs.existsSync(SETTINGS_FILE_PATH)) {
      const fileData = fs.readFileSync(SETTINGS_FILE_PATH, "utf-8");
      const parsed = JSON.parse(fileData);
      return { ...DEFAULT_PLATFORM_SETTINGS, ...parsed };
    }
  } catch (err) {
    console.warn("[PLATFORM SETTINGS] Could not read settings file, using defaults:", err);
  }
  return DEFAULT_PLATFORM_SETTINGS;
}

export async function savePlatformSettings(
  settings: Partial<PlatformSettings>,
  updatedBy: string = "Admin"
): Promise<PlatformSettings> {
  const current = await getPlatformSettings();
  const merged: PlatformSettings = {
    ...current,
    ...settings,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  try {
    const dir = path.dirname(SETTINGS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("[PLATFORM SETTINGS] Error writing settings to disk:", err);
  }

  return merged;
}
