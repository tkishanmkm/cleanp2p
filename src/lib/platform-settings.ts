import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/server";

export type PlatformControlKey =
  | "emergency_mode"
  | "prevent_new_trades"
  | "prevent_withdrawals"
  | "prevent_transfers"
  | "prevent_new_ads"
  | "prevent_user_login"
  | "prevent_new_signups"
  | "maintenance_mode";

export interface PlatformSettingsState {
  emergency_mode: boolean;
  prevent_new_trades: boolean;
  prevent_withdrawals: boolean;
  prevent_transfers: boolean;
  prevent_new_ads: boolean;
  prevent_user_login: boolean;
  prevent_new_signups: boolean;
  maintenance_mode: boolean;
  all_ads_paused_at: string | null;
  updated_at: string;
}

const DEFAULT_SETTINGS: PlatformSettingsState = {
  emergency_mode: false,
  prevent_new_trades: false,
  prevent_withdrawals: false,
  prevent_transfers: false,
  prevent_new_ads: false,
  prevent_user_login: false,
  prevent_new_signups: false,
  maintenance_mode: false,
  all_ads_paused_at: null,
  updated_at: new Date().toISOString(),
};

// In-memory cache for high-throughput reads (3-second TTL)
let cachedSettings: PlatformSettingsState | null = null;
let cacheExpiry = 0;

/**
 * Invalidate in-memory cache immediately upon settings update.
 */
export function invalidatePlatformSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

/**
 * Fetch all platform settings from the canonical system_settings table.
 * Fail closed when the database is unavailable or required control rows are missing.
 */
export async function getPlatformSettings(forceFresh = false): Promise<PlatformSettingsState> {
  const now = Date.now();
  if (!forceFresh && cachedSettings && now < cacheExpiry) {
    return cachedSettings;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("system_settings")
      .select("key, value, updated_at");

    if (error || !data) {
      throw new Error(`Unable to read required platform controls: ${error?.message || "empty database response"}`);
    }

    const requiredKeys: PlatformControlKey[] = [
      "emergency_mode",
      "prevent_new_trades",
      "prevent_withdrawals",
      "prevent_transfers",
      "prevent_new_ads",
      "prevent_user_login",
      "prevent_new_signups",
      "maintenance_mode",
    ];
    const returnedKeys = new Set(data.map((row: { key: string }) => row.key));
    const missingKeys = requiredKeys.filter((key) => !returnedKeys.has(key));
    if (missingKeys.length > 0) {
      throw new Error(`Required platform controls are missing: ${missingKeys.join(", ")}`);
    }

    const state: PlatformSettingsState = { ...DEFAULT_SETTINGS };
    let latestUpdate = DEFAULT_SETTINGS.updated_at;

    const parseControlBoolean = (key: PlatformControlKey, value: unknown): boolean => {
      if (typeof value === "boolean") return value;
      if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["true", "1", "t"].includes(normalized)) return true;
        if (["false", "0", "f"].includes(normalized)) return false;
      }
      throw new Error(`Platform control "${key}" has a missing or invalid boolean value.`);
    };

    data.forEach((row: { key: string; value: unknown; updated_at?: string | null }) => {
      const k = row.key;
      const v = row.value;

      switch (k) {
        case "emergency_mode":
          state.emergency_mode = parseControlBoolean(k, v);
          break;
        case "prevent_new_trades":
          state.prevent_new_trades = parseControlBoolean(k, v);
          break;
        case "prevent_withdrawals":
          state.prevent_withdrawals = parseControlBoolean(k, v);
          break;
        case "prevent_transfers":
          state.prevent_transfers = parseControlBoolean(k, v);
          break;
        case "prevent_new_ads":
          state.prevent_new_ads = parseControlBoolean(k, v);
          break;
        case "prevent_user_login":
          state.prevent_user_login = parseControlBoolean(k, v);
          break;
        case "prevent_new_signups":
          state.prevent_new_signups = parseControlBoolean(k, v);
          break;
        case "maintenance_mode":
          state.maintenance_mode = parseControlBoolean(k, v);
          break;
        case "all_ads_paused_at":
          state.all_ads_paused_at = v ? String(v) : null;
          break;
        default:
          break;
      }

      if (row.updated_at && row.updated_at > latestUpdate) latestUpdate = row.updated_at;
    });

    state.updated_at = latestUpdate;
    cachedSettings = state;
    cacheExpiry = now + 3000; // 3 seconds TTL

    return state;
  } catch (err) {
    // Never turn a control-plane outage into permissive defaults.
    invalidatePlatformSettingsCache();
    console.error("[PlatformSettings] Failed to fetch required controls:", err);
    throw err instanceof Error ? err : new Error("Platform controls unavailable");
  }
}

/**
 * Get a specific platform control boolean.
 */
export async function getPlatformControl(key: PlatformControlKey): Promise<boolean> {
  const settings = await getPlatformSettings();
  return Boolean(settings[key]);
}

/**
 * Persist platform controls through the service-only, actor-bound database RPC.
 * Data writes and admin audit entries commit or roll back together.
 */
export async function setPlatformSettingKey(
  key: PlatformControlKey,
  value: boolean,
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  const result = await setPlatformControls({ [key]: value }, adminId, adminEmail, reason);
  return result.success
    ? { success: true }
    : { success: false, error: result.error || "Platform control update was rejected." };
}

/**
 * Atomically update one or more platform controls through the canonical RPC.
 */
export async function setPlatformControls(
  updates: Partial<Record<PlatformControlKey, boolean>>,
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{ success: boolean; error?: string; updated?: Record<string, boolean> }> {
  const allowedKeys = new Set<PlatformControlKey>([
    "emergency_mode",
    "prevent_new_trades",
    "prevent_withdrawals",
    "prevent_transfers",
    "prevent_new_ads",
    "prevent_user_login",
    "prevent_new_signups",
    "maintenance_mode",
  ]);

  const entries = Object.entries(updates);
  if (!adminId || !adminEmail || entries.length < 1 || entries.length > 8) {
    return { success: false, error: "A verified administrator and at least one platform control are required." };
  }

  const normalized: Partial<Record<PlatformControlKey, boolean>> = {};
  for (const [key, value] of entries) {
    if (!allowedKeys.has(key as PlatformControlKey) || typeof value !== "boolean") {
      return { success: false, error: "Only allowlisted platform controls with boolean values may be changed." };
    }
    normalized[key as PlatformControlKey] = value;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.rpc("admin_set_platform_controls_authorized", {
      p_updates: normalized,
      p_reason: reason ?? null,
      p_actor_id: adminId,
      p_actor_email: adminEmail,
    });

    const result = data as { success?: boolean; updated?: Record<string, boolean> } | null;
    if (error || !result || result.success !== true) {
      throw new Error(error?.message || "The platform-control RPC did not confirm success.");
    }

    invalidatePlatformSettingsCache();
    return {
      success: true,
      updated: result.updated && typeof result.updated === "object" ? result.updated : normalized as Record<string, boolean>,
    };
  } catch (err: unknown) {
    console.error("[PlatformSettings] Atomic control update failed:", err instanceof Error ? err.message : "UnknownError");
    return {
      success: false,
      error: err instanceof Error ? err.message : "Platform controls could not be updated.",
    };
  }
}

/**
 * Check if a specific platform feature is currently blocked.
 * Fail-closed policy for financial actions (trades, withdrawals, transfers).
 */
export async function isFeaturePrevented(
  feature: "trades" | "withdrawals" | "transfers" | "ads" | "login" | "signup"
): Promise<{ prevented: boolean; error?: string; code?: string }> {
  try {
    const settings = await getPlatformSettings();

    // 1. MASTER EMERGENCY MODE: Overrides all individual feature gates
    if (settings.emergency_mode) {
      if (feature === "trades") {
        return { prevented: true, error: "New P2P trades are disabled: Master Emergency Mode is active.", code: "PLATFORM_EMERGENCY_MODE" };
      }
      if (feature === "withdrawals") {
        return { prevented: true, error: "Crypto withdrawals are disabled: Master Emergency Mode is active.", code: "PLATFORM_EMERGENCY_MODE" };
      }
      if (feature === "transfers") {
        return { prevented: true, error: "Internal transfers are disabled: Master Emergency Mode is active.", code: "PLATFORM_EMERGENCY_MODE" };
      }
      if (feature === "ads") {
        return { prevented: true, error: "Creating or modifying advertisements is disabled: Master Emergency Mode is active.", code: "PLATFORM_EMERGENCY_MODE" };
      }
      if (feature === "login") {
        return { prevented: true, error: "Master Emergency Mode is active. Normal user access is disabled.", code: "PLATFORM_EMERGENCY_MODE" };
      }
      if (feature === "signup") {
        return { prevented: true, error: "New user registration is disabled: Master Emergency Mode is active.", code: "PLATFORM_EMERGENCY_MODE" };
      }
    }

    if (settings.maintenance_mode) {
      if (feature === "trades") {
        return { prevented: true, error: "New trades are temporarily disabled due to scheduled maintenance.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
      if (feature === "withdrawals") {
        return { prevented: true, error: "Withdrawals are temporarily disabled due to scheduled maintenance.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
      if (feature === "transfers") {
        return { prevented: true, error: "Internal transfers are temporarily disabled due to scheduled maintenance.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
      if (feature === "ads") {
        return { prevented: true, error: "Creating new advertisements is temporarily disabled due to scheduled maintenance.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
      if (feature === "login") {
        return { prevented: true, error: "Maintenance mode is currently active. User login is temporarily disabled.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
      if (feature === "signup") {
        return { prevented: true, error: "New user registration is temporarily disabled due to scheduled maintenance.", code: "PLATFORM_MAINTENANCE_MODE" };
      }
    }

    if (feature === "trades" && settings.prevent_new_trades) {
      return { prevented: true, error: "New trades are temporarily disabled by the administrator.", code: "PLATFORM_TRADING_DISABLED" };
    }
    if (feature === "withdrawals" && settings.prevent_withdrawals) {
      return { prevented: true, error: "Withdrawals are temporarily disabled by the administrator.", code: "PLATFORM_WITHDRAWALS_DISABLED" };
    }
    if (feature === "transfers" && settings.prevent_transfers) {
      return { prevented: true, error: "Internal transfers are temporarily disabled by the administrator.", code: "PLATFORM_TRANSFERS_DISABLED" };
    }
    if (feature === "ads" && settings.prevent_new_ads) {
      return { prevented: true, error: "Creating new advertisements is temporarily disabled by the administrator.", code: "PLATFORM_AD_CREATION_DISABLED" };
    }
    if (feature === "login" && settings.prevent_user_login) {
      return { prevented: true, error: "User login is temporarily disabled by the administrator.", code: "PLATFORM_LOGIN_DISABLED" };
    }
    if (feature === "signup" && settings.prevent_new_signups) {
      return { prevented: true, error: "New user registration is temporarily disabled by the administrator.", code: "PLATFORM_SIGNUP_DISABLED" };
    }

    return { prevented: false };
  } catch (err: unknown) {
    console.error(`[isFeaturePrevented] Fail-closed check for ${feature}:`, err);
    return {
      prevented: true,
      error: "Operation temporarily unavailable because platform controls could not be verified. Please retry.",
      code: "PLATFORM_SERVICE_UNAVAILABLE",
    };
  }
}

/**
 * Non-terminal / Active Trade Check
 * Terminal statuses: completed, released, cancelled, canceled, expired
 */
export async function checkUserActiveTrades(userId: string): Promise<{
  hasActiveTrades: boolean;
  activeTradeCount: number;
  activeTradeIds: string[];
}> {
  if (!userId) {
    return { hasActiveTrades: false, activeTradeCount: 0, activeTradeIds: [] };
  }

  try {
    const supabase = getSupabaseAdminClient();
    const { data: userTrades, error } = await supabase
      .from("trades")
      .select("id, status, is_disputed")
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);

    if (error || !userTrades) {
      return { hasActiveTrades: false, activeTradeCount: 0, activeTradeIds: [] };
    }

    const TERMINAL_STATUSES = new Set([
      "completed",
      "released",
      "cancelled",
      "canceled",
      "expired",
    ]);

    const activeTrades = userTrades.filter((t: any) => {
      const s = String(t.status || "").toLowerCase().trim();
      if (t.is_disputed === true) return true;
      if (!s) return false;
      return !TERMINAL_STATUSES.has(s);
    });

    return {
      hasActiveTrades: activeTrades.length > 0,
      activeTradeCount: activeTrades.length,
      activeTradeIds: activeTrades.map((t: any) => String(t.id)),
    };
  } catch (err) {
    console.error("[checkUserActiveTrades] Error checking user trades:", err);
    return { hasActiveTrades: false, activeTradeCount: 0, activeTradeIds: [] };
  }
}

/**
 * Determines if a user is exempt from Maintenance Mode.
 * Exempt if:
 * 1. Admin account
 * 2. User with at least one active trade (retains access ONLY to active trade actions)
 */
export async function isUserExemptFromMaintenance(userId: string, userRole?: string): Promise<{
  isMaintenance: boolean;
  isExempt: boolean;
  isAdmin: boolean;
  hasActiveTrades: boolean;
  activeTradeCount: number;
  reason?: "admin" | "active_trades" | "none";
}> {
  const settings = await getPlatformSettings();

  // If neither emergency mode nor maintenance mode nor prevent_user_login is on
  if (!settings.emergency_mode && !settings.maintenance_mode && !settings.prevent_user_login) {
    return {
      isMaintenance: false,
      isExempt: true,
      isAdmin: userRole === "admin",
      hasActiveTrades: false,
      activeTradeCount: 0,
    };
  }

  // Check admin privileges first
  const supabase = getSupabaseAdminClient();
  let isAdmin = userRole === "admin";
  if (!isAdmin && userId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("role, is_admin, is_admin_account")
      .eq("id", userId)
      .maybeSingle();

    if (prof?.role === "admin" || prof?.is_admin === true || prof?.is_admin_account === true) {
      isAdmin = true;
    }
  }

  const isRestrictedPlatformMode = settings.emergency_mode || settings.maintenance_mode;

  if (isAdmin) {
    return {
      isMaintenance: isRestrictedPlatformMode,
      isExempt: true,
      isAdmin: true,
      hasActiveTrades: false,
      activeTradeCount: 0,
      reason: "admin",
    };
  }

  // Normal user: check qualifying active trade exception
  const tradeCheck = await checkUserActiveTrades(userId);
  if (tradeCheck.hasActiveTrades) {
    return {
      isMaintenance: isRestrictedPlatformMode,
      isExempt: true,
      isAdmin: false,
      hasActiveTrades: true,
      activeTradeCount: tradeCheck.activeTradeCount,
      reason: "active_trades",
    };
  }

  return {
    isMaintenance: isRestrictedPlatformMode,
    isExempt: false,
    isAdmin: false,
    hasActiveTrades: false,
    activeTradeCount: 0,
    reason: "none",
  };
}
