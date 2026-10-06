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
 * Fetch all platform settings from canonical system_settings table.
 * Falls back to default safe settings if database read fails.
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
      console.warn("[PlatformSettings] Error reading system_settings, using fallback defaults:", error?.message);
      return cachedSettings || DEFAULT_SETTINGS;
    }

    const state: PlatformSettingsState = { ...DEFAULT_SETTINGS };
    let latestUpdate = DEFAULT_SETTINGS.updated_at;

    data.forEach((row: any) => {
      const k = row.key;
      const v = row.value;
      const boolVal = typeof v === "boolean" ? v : v === "true" || v === true;

      if (k === "emergency_mode") state.emergency_mode = boolVal;
      if (k === "prevent_new_trades") state.prevent_new_trades = boolVal;
      if (k === "prevent_withdrawals") state.prevent_withdrawals = boolVal;
      if (k === "prevent_transfers") state.prevent_transfers = boolVal;
      if (k === "prevent_new_ads") state.prevent_new_ads = boolVal;
      if (k === "prevent_user_login") state.prevent_user_login = boolVal;
      if (k === "prevent_new_signups") state.prevent_new_signups = boolVal;
      if (k === "maintenance_mode") state.maintenance_mode = boolVal;
      if (k === "all_ads_paused_at") state.all_ads_paused_at = v ? String(v) : null;
      if (row.updated_at && row.updated_at > latestUpdate) latestUpdate = row.updated_at;
    });

    state.updated_at = latestUpdate;
    cachedSettings = state;
    cacheExpiry = now + 3000; // 3 seconds TTL

    return state;
  } catch (err) {
    console.error("[PlatformSettings] Failed to fetch settings:", err);
    return cachedSettings || DEFAULT_SETTINGS;
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
 * Helper to determine action name for admin audit logs.
 */
function getAuditAction(key: string, value: boolean): string {
  if (key === "emergency_mode") {
    return value ? "EMERGENCY_MODE_ENABLED" : "EMERGENCY_MODE_DISABLED";
  }
  if (key === "maintenance_mode") {
    return value ? "MAINTENANCE_MODE_ENABLED" : "MAINTENANCE_MODE_DISABLED";
  }
  if (key === "prevent_new_trades") {
    return value ? "GLOBAL_TRADING_DISABLED" : "GLOBAL_TRADING_ENABLED";
  }
  if (key === "prevent_withdrawals") {
    return value ? "GLOBAL_WITHDRAWALS_DISABLED" : "GLOBAL_WITHDRAWALS_ENABLED";
  }
  if (key === "prevent_transfers") {
    return value ? "GLOBAL_TRANSFERS_DISABLED" : "GLOBAL_TRANSFERS_ENABLED";
  }
  if (key === "prevent_new_ads") {
    return value ? "GLOBAL_AD_CREATION_DISABLED" : "GLOBAL_AD_CREATION_ENABLED";
  }
  if (key === "prevent_user_login") {
    return value ? "GLOBAL_LOGIN_DISABLED" : "GLOBAL_LOGIN_ENABLED";
  }
  if (key === "prevent_new_signups") {
    return value ? "GLOBAL_SIGNUP_DISABLED" : "GLOBAL_SIGNUP_ENABLED";
  }
  return `PLATFORM_CONTROL_${key.toUpperCase()}_${value ? "ENABLED" : "DISABLED"}`;
}

/**
 * Set a single platform setting key in canonical system_settings table.
 * Strictly stores boolean values as native JSON booleans.
 * Logs event to admin_audit_logs.
 */
export async function setPlatformSettingKey(
  key: keyof PlatformSettingsState,
  value: boolean | string | null,
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdminClient();

    // Fetch existing value for audit log tracking
    const { data: existingRow } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();

    const previousValue = existingRow?.value ?? null;

    // Store booleans natively as JSON booleans
    const jsonbValue = typeof value === "boolean" ? value : value;

    const { error } = await supabase
      .from("system_settings")
      .upsert(
        {
          key,
          value: jsonbValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    if (error) {
      throw error;
    }

    // Invalidate cache immediately
    invalidatePlatformSettingsCache();

    // Log to admin_audit_logs
    const auditAction = typeof value === "boolean"
      ? getAuditAction(key, value)
      : `PLATFORM_SETTING_${key.toUpperCase()}_UPDATED`;

    try {
      await supabase.from("admin_audit_logs").insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action: auditAction,
        target_id: key,
        details: {
          setting_key: key,
          previous_value: previousValue,
          new_value: value,
          reason: reason || "Manual administrator update",
          updated_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.warn("[PlatformSettings] Audit log error:", e?.message);
    }

    return { success: true };
  } catch (err: any) {
    console.error(`[PlatformSettings] Failed to set ${key}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Atomically update multiple platform controls in a batch.
 */
export async function setPlatformControls(
  updates: Partial<Record<PlatformControlKey, boolean>>,
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{ success: boolean; error?: string; updated?: Record<string, boolean> }> {
  const allowedKeys: PlatformControlKey[] = [
    "emergency_mode",
    "prevent_new_trades",
    "prevent_withdrawals",
    "prevent_transfers",
    "prevent_new_ads",
    "prevent_user_login",
    "prevent_new_signups",
    "maintenance_mode",
  ];

  const updated: Record<string, boolean> = {};

  for (const [k, v] of Object.entries(updates)) {
    if (!allowedKeys.includes(k as PlatformControlKey)) {
      continue;
    }
    if (typeof v === "boolean") {
      const res = await setPlatformSettingKey(k as PlatformControlKey, v, adminId, adminEmail, reason);
      if (!res.success) {
        return { success: false, error: res.error, updated };
      }
      updated[k] = v;
    }
  }

  return { success: true, updated };
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
  } catch (err: any) {
    console.error(`[isFeaturePrevented] Fail-closed check for ${feature}:`, err);
    if (feature === "trades" || feature === "withdrawals" || feature === "transfers") {
      return { prevented: true, error: "Operation temporarily unavailable due to system verification. Please try again.", code: "PLATFORM_SERVICE_UNAVAILABLE" };
    }
    return { prevented: false };
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
