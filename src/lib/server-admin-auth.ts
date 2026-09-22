import { NextRequest, NextResponse } from "next/server";
import { createClient, getSupabaseAdminClient } from "@/lib/supabase/server";

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
 * Never trusts request body parameters or client headers for identity.
 */
export async function verifyServerAdmin(req: NextRequest): Promise<AdminAuthResult> {
  try {
    const supabase = await createClient();
    const adminClient = getSupabaseAdminClient();

    // 1. Check session from cookies or Bearer Authorization header
    let { data: { user }, error: userError } = await supabase.auth.getUser();

    if (!user && req.headers.get("authorization")) {
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
    if (user.app_metadata?.role === "admin" || user.user_metadata?.role === "admin") {
      isAdmin = true;
    }

    // Check profiles table
    if (!isAdmin) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("role, is_admin, email")
        .eq("id", user.id)
        .maybeSingle();

      if (profile && (profile.role === "admin" || profile.is_admin === true)) {
        isAdmin = true;
      }
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
