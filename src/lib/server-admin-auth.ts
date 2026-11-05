import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient, getSupabaseAdminClient } from "@/lib/supabase/server";
import { ADMIN_2FA_COOKIE_NAME, verifyAdmin2FASessionToken } from "@/lib/admin-2fa-session";

export interface AdminAuthResult {
  authorized: boolean;
  user?: any;
  adminId?: string;
  adminEmail?: string;
  supportAdmin?: boolean;
  supportReadOnly?: boolean;
  emergencySessionId?: string;
  emergencyExpiresAt?: string;
  response?: NextResponse;
}

/**
 * Authoritatively verifies that the incoming request is made by an authenticated administrator.
 * Checks server-side cookies, Bearer tokens, profiles table, app_metadata, and app_admins table.
 * If Admin 2FA is enabled, strictly verifies the cryptographic pax_admin_2fa_session cookie.
 * Never trusts request body parameters or client headers for identity or 2FA verification.
 */
export async function verifyServerAdmin(
  req?: NextRequest,
  options: { allowSupportReadOnly?: boolean } = {},
): Promise<AdminAuthResult> {
  try {
    const supabase = await createClient();
    const adminClient = getSupabaseAdminClient();

    // 1. Check session from cookies or Bearer Authorization header
    let { data: { user }, error: userError } = await supabase.auth.getUser();

    if (!user && req && req.headers?.get("authorization")) {
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const { data: tokenUser, error: tokenError } = await adminClient.auth.getUser(token);
        if (!tokenError && tokenUser?.user) {
          user = tokenUser.user;
          userError = null;
        }
      }
    }

    if (userError || !user) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Authentication required. Please sign in as an administrator." },
          { status: 401 }
        ),
      };
    }

    // 2. Authoritative administrator verification.
    // Read the durable account state first, then ask the database's canonical
    // verification RPC. Never grant admin authority from JWT app_metadata,
    // client-editable user_metadata, an email allowlist, or a stale app_admins row.
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select(
        "role, is_admin, is_admin_account, email, status, account_status, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, admin_2fa_enabled, is_2fa_enabled, admin_2fa_recovery_updated_at"
      )
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[verifyServerAdmin] profile authorization lookup failed:", profileError.code || "unknown");
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator account state could not be verified." },
          { status: 503 },
        ),
      };
    }

    if (!profile) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "An active administrator profile is required." },
          { status: 403 },
        ),
      };
    }

    const profileStatus = String(profile.status || "").toLowerCase();
    const accountStatus = String(profile.account_status || "").toLowerCase();
    const accountBlocked =
      profile.is_banned === true ||
      profile.is_suspended === true ||
      profile.is_restricted === true ||
      profile.is_on_hold === true ||
      profile.is_emergency_frozen === true ||
      profile.is_minor_restricted === true ||
      profileStatus !== "active" ||
      ["banned", "suspended", "restricted", "frozen", "blocked", "deleted", "inactive", "closed", "on_hold", "hold", "deletion_pending"].includes(accountStatus);

    if (accountBlocked) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "This account is not eligible for administrator access.", code: "ADMIN_ACCOUNT_NOT_ACTIVE" },
          { status: 403 },
        ),
      };
    }

    const { data: adminVerification, error: adminVerificationError } = await adminClient.rpc(
      "verify_admin_login",
      { user_uuid: user.id },
    );

    if (adminVerificationError) {
      console.error("[verifyServerAdmin] canonical admin verification failed:", adminVerificationError.code || "unknown");
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator privileges could not be verified." },
          { status: 503 },
        ),
      };
    }

    let isAdmin = adminVerification?.[0]?.is_valid === true;
    const adminProfile: any = profile;

    let isSupportAdmin = false;
    let supportEmergencySession: { id: string; expires_at: string } | null = null;
    if (!isAdmin) {
      const { data: supportGrant, error: supportGrantError } = await adminClient
        .from("support_admin_grants")
        .select("user_id, is_enabled, emergency_uses_remaining")
        .eq("user_id", user.id)
        .eq("is_enabled", true)
        .maybeSingle();

      if (supportGrantError) {
        console.error("[verifyServerAdmin] support-admin grant lookup failed:", supportGrantError.code || "unknown");
        return {
          authorized: false,
          response: NextResponse.json(
            { success: false, error: "Administrator permissions could not be verified." },
            { status: 503 },
          ),
        };
      }

      if (supportGrant) {
        isSupportAdmin = true;
        const { data: activeSession, error: sessionError } = await adminClient
          .from("support_admin_emergency_sessions")
          .select("id, expires_at")
          .eq("support_admin_id", user.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("activated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (sessionError) {
          console.error("[verifyServerAdmin] support-admin session lookup failed:", sessionError.code || "unknown");
          return {
            authorized: false,
            response: NextResponse.json(
              { success: false, error: "Emergency-mode status could not be verified." },
              { status: 503 },
            ),
          };
        }

        if (activeSession) {
          supportEmergencySession = activeSession;
          isAdmin = true;
        } else if (options.allowSupportReadOnly) {
          return {
            authorized: true,
            user,
            adminId: user.id,
            adminEmail: user.email || undefined,
            supportAdmin: true,
            supportReadOnly: true,
          };
        }
      }
    }

    if (!isAdmin) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Access denied. Administrator privileges required." },
          { status: 403 }
        ),
      };
    }

    // Emergency privileges require an enrolled 2FA profile and a fresh signed 2FA session cookie.
    if (isSupportAdmin && supportEmergencySession &&
        (!adminProfile || !(adminProfile.admin_2fa_enabled || adminProfile.is_2fa_enabled))) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Emergency mode requires verified administrator two-factor authentication.", code: "2FA_REQUIRED" },
          { status: 403 },
        ),
      };
    }

    // 3. Admin 2FA Enforcement Gate
    const is2FAEnabled = Boolean(adminProfile?.admin_2fa_enabled || adminProfile?.is_2fa_enabled);

    if (is2FAEnabled) {
      // Extract cookie from NextRequest or Supabase cookies
      let sessionCookie: string | undefined;
      if (req) {
        sessionCookie = req.cookies.get(ADMIN_2FA_COOKIE_NAME)?.value;
      } else {
        // Server Actions do not receive a NextRequest. Read the request-scoped
        // cookie store so they enforce the same signed 2FA gate as API routes.
        try {
          const cookieStore = await cookies();
          sessionCookie = cookieStore.get(ADMIN_2FA_COOKIE_NAME)?.value;
        } catch {
          // No request cookie context is a closed failure, not an exemption.
          sessionCookie = undefined;
        }
      }

      if (!sessionCookie && req) {
        // Compatibility fallback for request adapters exposing only headers.
        const cookieHeader = req.headers.get("cookie") || "";
        const match = cookieHeader.match(new RegExp(`(?:^|; )${ADMIN_2FA_COOKIE_NAME}=([^;]*)`));
        if (match) {
          sessionCookie = decodeURIComponent(match[1]);
        }
      }
      const securityVersion = adminProfile?.admin_2fa_recovery_updated_at || user.id;
      const verification = verifyAdmin2FASessionToken(sessionCookie, user.id, securityVersion);

      if (!verification.valid) {
        return {
          authorized: false,
          response: NextResponse.json(
            {
              success: false,
              error: "Admin 2FA verification required. Please complete two-factor authentication.",
              code: "2FA_REQUIRED",
              details: verification.reason,
            },
            { status: 403 }
          ),
        };
      }
    }

    if (isSupportAdmin && supportEmergencySession && req) {
      const routePath = req.nextUrl?.pathname || new URL(req.url).pathname;
      const method = req.method.toUpperCase();
      const routeSegments = routePath.split("/").filter(Boolean);
      const isTradeIdPath =
        routeSegments.length === 4 &&
        routeSegments[0] === "api" &&
        routeSegments[1] === "admin" &&
        routeSegments[2] === "trades" &&
        Boolean(routeSegments[3]);
      const isTradeMessagesPath =
        routeSegments.length === 4 &&
        routeSegments[0] === "api" &&
        routeSegments[1] === "trades" &&
        Boolean(routeSegments[2]) &&
        routeSegments[3] === "messages";
      const isTradeSystemMessagePath =
        routeSegments.length === 4 &&
        routeSegments[0] === "api" &&
        routeSegments[1] === "trades" &&
        Boolean(routeSegments[2]) &&
        routeSegments[3] === "system-message";
      const isSupportStatusPath = routePath === "/api/admin/support-admins/status";

      // Emergency support sessions are deliberately narrower than full-admin
      // sessions. They can view a trade case/chat and post moderator chat
      // messages through the dedicated trade route, but cannot use global admin
      // pages, wallet/ledger APIs, account-management endpoints, or settlement.
      const allowedRead =
        (method === "GET" || method === "HEAD") &&
        (isTradeIdPath || isTradeMessagesPath || isTradeSystemMessagePath || isSupportStatusPath);
      const allowedWrite =
        method === "POST" &&
        (isTradeIdPath || isTradeSystemMessagePath);

      if (!allowedRead && !allowedWrite) {
        return {
          authorized: false,
          response: NextResponse.json(
            { success: false, error: "This emergency support session is not authorized for the requested route.", code: "SUPPORT_ADMIN_SCOPE_DENIED" },
            { status: 403 },
          ),
        };
      }

      const { error: activityError } = await adminClient.from("support_admin_activity").insert({
        support_admin_id: user.id,
        emergency_session_id: supportEmergencySession.id,
        action: `${method} ${routePath}`.slice(0, 200),
        target_type: "api_route",
        target_id: routePath.slice(0, 200),
        outcome: "attempted",
        details: { method, path: routePath, access_type: allowedWrite ? "support_action" : "case_read" },
      });
      if (activityError) {
        console.error("[verifyServerAdmin] support emergency audit failed:", activityError.code || "unknown");
        return {
          authorized: false,
          response: NextResponse.json(
            { success: false, error: "Emergency action logging is unavailable; the request was blocked." },
            { status: 503 },
          ),
        };
      }
    }

    return {
      authorized: true,
      user,
      adminId: user.id,
      adminEmail: user.email || undefined,
      supportAdmin: isSupportAdmin,
      supportReadOnly: false,
      emergencySessionId: supportEmergencySession?.id,
      emergencyExpiresAt: supportEmergencySession?.expires_at,
    };
  } catch (err: any) {
    console.error("[verifyServerAdmin] Error during admin authorization check:", err);
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, error: "Internal authorization check failed." },
        { status: 500 }
      ),
    };
  }
}
