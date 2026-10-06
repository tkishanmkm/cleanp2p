import { NextRequest, NextResponse } from "next/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import {
  getPlatformSettings,
  setPlatformSettingKey,
  PlatformControlKey,
} from "@/lib/platform-settings";

export const dynamic = "force-dynamic";

const ALLOWED_KEYS: readonly PlatformControlKey[] = [
  "emergency_mode",
  "prevent_new_trades",
  "prevent_withdrawals",
  "prevent_transfers",
  "prevent_new_ads",
  "prevent_user_login",
  "prevent_new_signups",
  "maintenance_mode",
] as const;

export async function GET(req: NextRequest) {
  try {
    const platformSettings = await getPlatformSettings(true);

    const auth = await verifyServerAdmin(req);
    const isAdmin = auth.authorized;

    if (!isAdmin) {
      // Safe subset for non-admin callers (only status flags)
      return NextResponse.json({
        emergency_mode: platformSettings.emergency_mode,
        prevent_new_trades: platformSettings.prevent_new_trades,
        prevent_withdrawals: platformSettings.prevent_withdrawals,
        prevent_transfers: platformSettings.prevent_transfers,
        prevent_new_ads: platformSettings.prevent_new_ads,
        prevent_user_login: platformSettings.prevent_user_login,
        prevent_new_signups: platformSettings.prevent_new_signups,
        maintenance_mode: platformSettings.maintenance_mode,
        updated_at: platformSettings.updated_at,
      });
    }

    return NextResponse.json({
      success: true,
      settings: platformSettings,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await req.json().catch(() => ({}));
    const adminEmail = auth.adminEmail || "admin@paxones.com";
    const adminId = auth.adminId || auth.user.id;
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;

    // Check for invalid keys in the request body
    const bodyKeys = Object.keys(body).filter((k) => k !== "reason");
    if (bodyKeys.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one valid global control key must be provided." },
        { status: 400 }
      );
    }

    for (const key of bodyKeys) {
      if (!ALLOWED_KEYS.includes(key as PlatformControlKey)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid control key '${key}'. Allowed keys: ${ALLOWED_KEYS.join(", ")}`,
          },
          { status: 400 }
        );
      }
      if (typeof body[key] !== "boolean") {
        return NextResponse.json(
          {
            success: false,
            error: `Value for '${key}' must be a boolean (true or false).`,
          },
          { status: 400 }
        );
      }
    }

    const updated: Record<string, boolean> = {};

    for (const key of bodyKeys) {
      const boolVal = body[key] as boolean;
      const res = await setPlatformSettingKey(
        key as PlatformControlKey,
        boolVal,
        adminId,
        adminEmail,
        reason
      );
      if (!res.success) {
        return NextResponse.json(
          { success: false, error: res.error || `Failed to update ${key}.` },
          { status: 500 }
        );
      }
      updated[key] = boolVal;
    }

    // Refresh platform settings
    const current = await getPlatformSettings(true);

    return NextResponse.json({
      success: true,
      message: "Global platform controls updated successfully.",
      updated,
      settings: current,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
