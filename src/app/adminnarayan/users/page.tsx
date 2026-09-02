import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { UserTableClient } from "./user-table-client";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = await createClient();

  // 1. Verify Auth & Admin Role
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/adminnarayan/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/unauthorized");

  // 2. Fetch User Profiles using Service Role to bypass standard user RLS
  const adminSupabase = createAdminClient();
  const { data: profiles, error } = await adminSupabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return <div className="p-6 text-red-500">Error loading users: {error.message}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
        <p className="text-muted-foreground">
          View user accounts, adjust wallet balances, and enforce moderation.
        </p>
      </div>

      <UserTableClient initialProfiles={profiles || []} />
    </div>
  );
}
