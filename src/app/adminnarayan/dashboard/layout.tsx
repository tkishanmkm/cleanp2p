import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 1. Fetch current user if cookies are present
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const currentUser =
      user || (await supabase.auth.getSession()).data.session?.user;

    // Only if the server affirmatively detected a logged-in user who is NOT an admin, redirect
    if (currentUser) {
      let isAdmin = false;
      try {
        const { data: verificationResult, error: rpcError } = await supabase.rpc(
          "verify_admin_login",
          { user_uuid: currentUser.id }
        );
        if (!rpcError && verificationResult?.[0]?.is_valid === true) {
          isAdmin = true;
        }
      } catch {}

      if (!isAdmin) {
        try {
          const { data: checkRes, error: checkErr } = await supabase.rpc(
            "check_is_admin",
            { user_uuid: currentUser.id }
          );
          if (!checkErr && (checkRes === true || checkRes?.[0]?.is_valid === true)) {
            isAdmin = true;
          }
        } catch {}
      }

      if (!isAdmin) {
        try {
          const adminSupabase = createAdminClient();
          const { data: profile } = await adminSupabase
            .from("profiles")
            .select("role, is_suspended")
            .eq("id", currentUser.id)
            .maybeSingle();

          if (
            profile &&
            profile.role?.toLowerCase() === "admin" &&
            !profile.is_suspended
          ) {
            isAdmin = true;
          }
        } catch {}
      }

      if (!isAdmin) {
        redirect("/adminnarayan/login?error=unauthorized");
      }
    }
  } catch {}

  return <section>{children}</section>;
}
