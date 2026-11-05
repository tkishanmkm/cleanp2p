import { NextRequest, NextResponse } from "next/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { getPlatformSettings, type PlatformControlKey } from "@/lib/platform-settings";

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

    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    const canReadFullAdminSettings = auth.authorized && auth.supportAdmin !== true && auth.supportReadOnly !== true;

    if (!canReadFullAdminSettings) {
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
    // Support-admin emergency sessions are scoped to support workflows, not global controls.
    if (auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: "Support administrators cannot change global platform settings." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "A valid JSON object is required." }, { status: 400 });
    }
    const adminEmail = auth.adminEmail || "";
    const adminId = auth.adminId || auth.user.id;
    if (body.reason !== undefined && body.reason !== null && typeof body.reason !== "string") {
      return NextResponse.json({ success: false, error: "Reason must be text." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
    if (reason && reason.length > 1000) {
      return NextResponse.json({ success: false, error: "Reason must not exceed 1,000 characters." }, { status: 400 });
    }

    // Check for invalid keys in the request body
    const bodyKeys = Object.keys(body).filter((k) => k !== "reason");
    if (bodyKeys.length === 0 || bodyKeys.length > ALLOWED_KEYS.length) {
      return NextResponse.json(
        { success: false, error: "Provide between one and eight global control keys." },
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

    if (body.emergency_mode === true && (!reason || reason.length < 3)) {
      return NextResponse.json(
        { success: false, error: "A reason of at least 3 characters is required to enable emergency mode." },
        { status: 400 }
      );
    }

    const updates = Object.fromEntries(bodyKeys.map((key) => [key, body[key]]));
    const adminClient = getSupabaseAdminClient();
    const { data: updateResult, error: updateError } = await adminClient.rpc(
      "admin_set_platform_controls_authorized",
      {
        p_updates: updates,
        p_reason: reason ?? null,
        p_actor_id: adminId,
        p_actor_email: adminEmail || null,
      }
    );

    if (updateError || !updateResult || updateResult.success !== true) {
      console.error("[AdminPlatformSettings] Atomic platform-control update failed:", updateError?.code || "invalid_rpc_response");
      return NextResponse.json(
        {
          success: false,
          error: "Platform controls could not be updated and audited. No changes were committed.",
        },
        { status: updateError?.code === "42501" ? 403 : 503 }
      );
    }

    const updated = (updateResult.updated || updates) as Record<string, boolean>;

    // The atomic RPC has committed both control rows and audit entries. A failed
    // cache-refresh read must not turn that committed update into a false failure.
    let current: Awaited<ReturnType<typeof getPlatformSettings>> | null = null;
    try {
      current = await getPlatformSettings(true);
    } catch (refreshError) {
      console.error("[AdminPlatformSettings] Control update committed but settings refresh failed:", refreshError);
    }

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
