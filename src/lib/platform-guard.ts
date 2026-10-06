import {
  getPlatformSettings,
  checkUserActiveTrades,
  PlatformControlKey,
} from "./platform-settings";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { assertUserNotEmergencyFrozen } from "@/lib/user-freeze";

export type PlatformAction =
  | "trade"
  | "withdrawal"
  | "transfer"
  | "new_ad"
  | "login"
  | "signup";

export type PlatformErrorCode =
  | "PLATFORM_EMERGENCY_MODE"
  | "PLATFORM_TRADING_DISABLED"
  | "PLATFORM_WITHDRAWALS_DISABLED"
  | "PLATFORM_TRANSFERS_DISABLED"
  | "PLATFORM_AD_CREATION_DISABLED"
  | "PLATFORM_LOGIN_DISABLED"
  | "PLATFORM_SIGNUP_DISABLED"
  | "PLATFORM_MAINTENANCE_MODE"
  | "PLATFORM_SECURITY_RESTRICTION"
  | "PLATFORM_SERVICE_UNAVAILABLE";

export class PlatformControlError extends Error {
  public readonly code: PlatformErrorCode;
  public readonly statusCode: number;

  constructor(message: string, code: PlatformErrorCode, statusCode = 403) {
    super(message);
    this.name = "PlatformControlError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface GuardOptions {
  userId?: string;
  userRole?: string;
  userEmail?: string;
  isAdmin?: boolean;
}

/**
 * Helper to authoritatively check if a user is an administrator.
 * Checks role === 'admin' OR is_admin === true OR is_admin_account === true.
 */
async function checkIsAdmin(userId?: string, userRole?: string): Promise<boolean> {
  if (userRole === "admin") return true;
  if (!userId) return false;

  try {
    const supabase = getSupabaseAdminClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_admin, is_admin_account")
      .eq("id", userId)
      .maybeSingle();

    if (profile && (profile.role === "admin" || profile.is_admin === true || profile.is_admin_account === true)) {
      return true;
    }
  } catch (err) {
    console.warn("[PlatformGuard] Error verifying admin status:", err);
  }
  return false;
}

/**
 * Authoritative Server-Side Guard for Global Platform Controls.
 * Throws PlatformControlError with machine-readable code if the action is prevented.
 */
export async function assertPlatformControlAllowed(
  action: PlatformAction,
  options: GuardOptions = {}
): Promise<void> {
  let settings;
  try {
    settings = await getPlatformSettings();
  } catch (err) {
    console.error("[PlatformGuard] Failed to fetch settings, applying fail-closed policy:", err);
    throw new PlatformControlError(
      "Service temporarily unavailable due to system verification. Please try again shortly.",
      "PLATFORM_SERVICE_UNAVAILABLE",
      503
    );
  }

  const isAdmin = options.isAdmin ?? (await checkIsAdmin(options.userId, options.userRole));

  // Authoritative Individual Emergency Freeze Enforcement
  if (options.userId && !isAdmin && ["trade", "withdrawal", "transfer", "new_ad"].includes(action)) {
    await assertUserNotEmergencyFrozen(options.userId);
  }

  // 1. MASTER GLOBAL EMERGENCY MODE
  // Stops new platform activity while allowing qualifying active trades to complete safely
  if (settings.emergency_mode) {
    if (action === "login") {
      if (!isAdmin) {
        if (options.userId) {
          const tradeCheck = await checkUserActiveTrades(options.userId);
          if (tradeCheck.hasActiveTrades) {
            return; // Allowed strictly for completing qualifying active trades
          }
        }
        throw new PlatformControlError(
          "Master Emergency Mode is active. Platform access is restricted to administrators and participants with qualifying active trades.",
          "PLATFORM_EMERGENCY_MODE",
          403
        );
      }
    } else {
      throw new PlatformControlError(
        `Master Emergency Mode is active. New ${action.toUpperCase()} operations are strictly suspended.`,
        "PLATFORM_EMERGENCY_MODE",
        403
      );
    }
  }

  // 2. Maintenance Mode Rules
  if (settings.maintenance_mode) {
    // Admins are fully exempt from maintenance mode restrictions
    if (isAdmin) {
      return;
    }

    // During maintenance: NO new trades, NO withdrawals, NO transfers, NO new ads, NO signups
    if (action === "trade") {
      throw new PlatformControlError(
        "Platform is currently undergoing scheduled maintenance. Initiating new trades is temporarily disabled.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }

    if (action === "withdrawal") {
      throw new PlatformControlError(
        "Platform is currently undergoing scheduled maintenance. Withdrawals are temporarily disabled.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }

    if (action === "transfer") {
      throw new PlatformControlError(
        "Platform is currently undergoing scheduled maintenance. Internal transfers are temporarily disabled.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }

    if (action === "new_ad") {
      throw new PlatformControlError(
        "Platform is currently undergoing scheduled maintenance. Creating new advertisements is temporarily disabled.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }

    if (action === "signup") {
      throw new PlatformControlError(
        "Platform is currently undergoing scheduled maintenance. New user registrations are temporarily paused.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }

    if (action === "login") {
      // Normal users: only allowed if they have an active qualifying trade that requires completion
      if (options.userId) {
        const tradeCheck = await checkUserActiveTrades(options.userId);
        if (tradeCheck.hasActiveTrades) {
          return; // Allowed for active trade continuation
        }
      }
      throw new PlatformControlError(
        "Platform is currently undergoing maintenance. User access is temporarily disabled.",
        "PLATFORM_MAINTENANCE_MODE",
        403
      );
    }
  }

  // 2. Individual Feature Controls

  // New Trades
  if (action === "trade" && settings.prevent_new_trades) {
    throw new PlatformControlError(
      "Initiating new P2P trades is temporarily disabled by administrator.",
      "PLATFORM_TRADING_DISABLED",
      403
    );
  }

  // Withdrawals
  if (action === "withdrawal" && settings.prevent_withdrawals) {
    throw new PlatformControlError(
      "Crypto withdrawals are temporarily disabled by administrator.",
      "PLATFORM_WITHDRAWALS_DISABLED",
      403
    );
  }

  // Transfers
  if (action === "transfer" && settings.prevent_transfers) {
    throw new PlatformControlError(
      "Internal user-to-user transfers are temporarily disabled by administrator.",
      "PLATFORM_TRANSFERS_DISABLED",
      403
    );
  }

  // New Ads
  if (action === "new_ad" && settings.prevent_new_ads) {
    throw new PlatformControlError(
      "Creating new advertisements is temporarily disabled by administrator.",
      "PLATFORM_AD_CREATION_DISABLED",
      403
    );
  }

  // User Login
  if (action === "login" && settings.prevent_user_login) {
    if (!isAdmin) {
      throw new PlatformControlError(
        "User login is temporarily disabled by administrator.",
        "PLATFORM_LOGIN_DISABLED",
        403
      );
    }
  }

  // New Signups
  if (action === "signup" && settings.prevent_new_signups) {
    throw new PlatformControlError(
      "New user registration is temporarily disabled by administrator.",
      "PLATFORM_SIGNUP_DISABLED",
      403
    );
  }
}
