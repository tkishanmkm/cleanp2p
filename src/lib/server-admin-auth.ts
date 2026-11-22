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

    // 2. Authoritative Admin Role Verification.
    // Client-controlled user_metadata and stale JWT role claims are never authorization sources.
    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("role, is_admin, is_admin_account, is_banned, is_restricted, is_on_hold, is_suspended, account_status, status, email, admin_2fa_enabled, is_2fa_enabled, admin_2fa_recovery_updated_at")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("[verifyServerAdmin] Profile authorization lookup failed:", profileError);
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator authorization is temporarily unavailable." },
          { status: 503 }
        ),
      };
    }

    // An admin account must have a live profile and must not be banned, suspended or held.
    if (!profile) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator account is inactive or unavailable." },
          { status: 403 }
        ),
      };
    }

    const accountStatus = String(profile.account_status || profile.status || "").trim().toLowerCase();
    const profileActive =
      profile.is_banned !== true &&
      profile.is_restricted !== true &&
      profile.is_on_hold !== true &&
      profile.is_suspended !== true &&
      !["banned", "restricted", "suspended", "on_hold", "hold", "frozen", "disabled", "closed", "deleted", "deletion_pending"].includes(accountStatus);

    if (!profileActive) {
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator account is inactive or unavailable." },
          { status: 403 }
        ),
      };
    }

    const adminProfile: any = profile;
    const profileAdmin =
      profile.role === "admin" ||
      profile.is_admin === true ||
      profile.is_admin_account === true;

    const { data: appAdmin, error: appAdminError } = await adminClient
      .from("app_admins")
      .select("user_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (appAdminError) {
      console.error("[verifyServerAdmin] Admin membership lookup failed:", appAdminError);
      return {
        authorized: false,
        response: NextResponse.json(
          { success: false, error: "Administrator authorization is temporarily unavailable." },
          { status: 503 }
        ),
      };
    }

    const membershipAdmin =
      appAdmin?.role === "admin" ||
      appAdmin?.role === "superadmin";

    if (!profileAdmin && !membershipAdmin) {
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
      adminEmail: user.email || adminProfile.email || "",
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
