import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type AdminVerification = {
  is_valid?: boolean;
};

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Keep Next.js redirect() outside try/catch blocks: redirect intentionally
  // throws a framework signal, which broad catches can accidentally swallow.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  let authVerificationFailed = false;
  try {
    const result = await supabase.auth.getUser();
    if (result.error) {
      authVerificationFailed = true;
    } else {
      user = result.data.user;
    }
  } catch {
    authVerificationFailed = true;
  }

  if (authVerificationFailed) {
    redirect("/adminnarayan/login?error=verification_unavailable");
  }
  if (!user) {
    redirect("/adminnarayan/login");
  }

  let verificationResult: AdminVerification[] | null = null;
  let rpcVerificationFailed = false;
  try {
    const result = await supabase.rpc("verify_admin_login", {
      user_uuid: user.id,
    });
    if (result.error) {
      rpcVerificationFailed = true;
    } else {
      verificationResult = result.data as AdminVerification[] | null;
    }
  } catch {
    rpcVerificationFailed = true;
  }

  if (rpcVerificationFailed) {
    redirect("/adminnarayan/login?error=verification_unavailable");
  }
  if (verificationResult?.[0]?.is_valid !== true) {
    // Support admins are not full admins in verify_admin_login; allow only an explicit server-side grant.
    let supportGrantEnabled = false;
    let supportGrantLookupFailed = false;
    try {
      const supportAdminDb = createAdminClient();
      const { data: supportGrant, error: supportGrantError } = await supportAdminDb
        .from("support_admin_grants")
        .select("user_id, is_enabled")
        .eq("user_id", user.id)
        .eq("is_enabled", true)
        .maybeSingle();
      if (supportGrantError) {
        supportGrantLookupFailed = true;
      } else {
        supportGrantEnabled = Boolean(supportGrant?.is_enabled);
      }
    } catch {
      supportGrantLookupFailed = true;
    }
    if (supportGrantLookupFailed) {
      redirect("/adminnarayan/login?error=verification_unavailable");
    }
    if (!supportGrantEnabled) {
      redirect("/adminnarayan/login?error=unauthorized");
    }
  }

  // Independently enforce account lifecycle restrictions using the server-only
  // service-role client because profile RLS may prevent self-profile reads.
  let profile: {
    is_banned: boolean | null;
    is_suspended: boolean | null;
    is_restricted: boolean | null;
    is_on_hold: boolean | null;
    is_emergency_frozen: boolean | null;
    is_minor_restricted: boolean | null;
    status: string | null;
    account_status: string | null;
  } | null = null;
  let profileLookupFailed = false;

  try {
    const adminSupabase = createAdminClient();
    const result = await adminSupabase
      .from("profiles")
      .select("is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status")
      .eq("id", user.id)
      .maybeSingle();

    if (result.error || !result.data) {
      profileLookupFailed = true;
    } else {
      profile = result.data;
    }
  } catch {
    profileLookupFailed = true;
  }

  if (profileLookupFailed || !profile) {
    redirect("/adminnarayan/login?error=account_status_unavailable");
  }

  const status = String(profile.status || "").toLowerCase();
  const accountStatus = String(profile.account_status || "").toUpperCase();
  const isBanned =
    profile.is_banned === true ||
    status === "banned" ||
    accountStatus === "BANNED";
  const isSuspended =
    profile.is_suspended === true ||
    status === "suspended" ||
    status === "on_hold" ||
    status === "hold" ||
    accountStatus === "SUSPENDED" ||
    accountStatus === "ON_HOLD" ||
    accountStatus === "HOLD";
  const isRestricted =
    profile.is_restricted === true ||
    status === "restricted" ||
    accountStatus === "RESTRICTED";
  const isFrozenOrOtherRestricted =
    profile.is_on_hold === true ||
    profile.is_emergency_frozen === true ||
    profile.is_minor_restricted === true;
  const isDeleted =
    status === "deleted" ||
    accountStatus === "DELETED" ||
    accountStatus === "DELETION_PENDING";

  if (isBanned || isSuspended || isRestricted || isFrozenOrOtherRestricted || isDeleted) {
    redirect("/adminnarayan/login?error=account_restricted");
  }

  return <section>{children}</section>;
}
