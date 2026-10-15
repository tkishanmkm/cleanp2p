import { NextRequest, NextResponse } from "next/server";
import { createClient, getSupabaseAdminClient } from "@/lib/supabase/server";
import { ADMIN_2FA_COOKIE_NAME, verifyAdmin2FASessionToken } from "@/lib/admin-2fa-session";

export interface AdminAuthResult {
  authorized: boolean;
  user?: any;
  adminId?: string;
  adminEmail?: string;
  response?: NextResponse;
}

/**
 * Authoritatively verifies that the incoming request is made by an authenticated administrator.
 * Checks server-side cookies, Bearer tokens, profiles table, app_metadata, and app_admins table.
 * If Admin 2FA is enabled, strictly verifies the cryptographic pax_admin_2fa_session cookie.
 * Never trusts request body parameters or client headers for identity or 2FA verification.
 */
export async function verifyServerAdmin(req?: NextRequest): Promise<AdminAuthResult> {
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

    // 2. Authoritative Admin Role Verification
    let isAdmin = false;

    // Check JWT app_metadata
    // Only trusted server-managed app_metadata may grant the role directly.
    // user_metadata is user-editable and must never grant administrator access.
    if (user.app_metadata?.role === "admin") {
      isAdmin = true;
    }

    // Check profiles table
    let adminProfile: any = null;
    const { data: profile } = await adminClient
      .from("profiles")
      .select("role, is_admin, is_admin_account, email, admin_2fa_enabled, is_2fa_enabled, admin_2fa_recovery_updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) {
      // profiles has a self-update policy, so role/is_admin fields read here are
      // not an authoritative privilege source. Keep this row only for the
      // existing 2FA settings lookup; admin membership is checked below using
      // trusted app_metadata, app_admins, or the server environment allowlist.
      adminProfile = profile;
    }

    // Check app_admins table
    if (!isAdmin) {
      const { data: appAdmin } = await adminClient
        .from("app_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (appAdmin) {
        isAdmin = true;
      }
    }

    // Check environment admin list fallback
    if (!isAdmin && user.email) {
      const configuredAdmins = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      
      if (configuredAdmins.includes(user.email.toLowerCase())) {
        isAdmin = true;
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

    // 3. Admin 2FA Enforcement Gate
    const is2FAEnabled = Boolean(adminProfile?.admin_2fa_enabled || adminProfile?.is_2fa_enabled);

    if (is2FAEnabled) {
      // Extract cookie from NextRequest or Supabase cookies
      let sessionCookie: string | undefined;
      if (req) {
        sessionCookie = req.cookies.get(ADMIN_2FA_COOKIE_NAME)?.value;
      }

      if (!sessionCookie) {
        // Fallback to checking Next.js headers cookie string
        const cookieHeader = req?.headers.get("cookie") || "";
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

    return {
      authorized: true,
      user,
      adminId: user.id,
      adminEmail: user.email || "admin@paxones.com",
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
