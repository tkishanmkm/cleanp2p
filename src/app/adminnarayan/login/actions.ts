"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export async function loginAdminAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Please provide both email and password." };
  }

  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return { error: "Authentication failed. Check your credentials and try again." };
  }

  try {
    const adminSupabase = createAdminClient();
    const { data: verification, error: verificationError } = await adminSupabase.rpc(
      "verify_admin_login",
      { user_uuid: authData.user.id },
    );

    if (verificationError || verification?.[0]?.is_valid !== true) {
      await supabase.auth.signOut();
      return { error: "Access denied. An active administrator account is required." };
    }

    const { data: profile, error: profileError } = await adminSupabase
      .from("profiles")
      .select(
        "admin_2fa_enabled, is_2fa_enabled, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status"
      )
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return { error: "Administrator account state could not be verified." };
    }

    const status = String(profile.status || "").toLowerCase();
    const accountStatus = String(profile.account_status || "").toLowerCase();
    const blocked =
      profile.is_banned === true ||
      profile.is_suspended === true ||
      profile.is_restricted === true ||
      profile.is_on_hold === true ||
      profile.is_emergency_frozen === true ||
      profile.is_minor_restricted === true ||
      status !== "active" ||
      ["banned", "suspended", "restricted", "on_hold", "hold", "inactive", "deleted", "deletion_pending"].includes(accountStatus);

    if (blocked) {
      await supabase.auth.signOut();
      return { error: "This administrator account is not active or eligible for access." };
    }

    if (profile.admin_2fa_enabled === true || profile.is_2fa_enabled === true) {
      redirect("/adminnarayan/login/challenge");
    }

    redirect("/adminnarayan/dashboard");
  } catch (error) {
    // Next's redirect signal must propagate; all other failures sign out.
    if (error && typeof error === "object" && "digest" in error) throw error;
    await supabase.auth.signOut();
    return { error: "Administrator access could not be verified. Please retry." };
  }
}
