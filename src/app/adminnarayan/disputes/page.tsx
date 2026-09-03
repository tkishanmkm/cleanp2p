import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { DisputeTableClient } from "./dispute-table-client";

export const dynamic = "force-dynamic";

export default async function AdminDisputesPage() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const adminSupabase = createAdminClient();
      const { data: profile } = await adminSupabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();

      if (profile && profile.role?.toLowerCase() !== "admin") {
        redirect("/unauthorized");
      }
    }
  } catch (err: any) {
    if (err?.digest?.includes("NEXT_REDIRECT")) throw err;
  }

  // 2. Fetch Open & Resolved Disputes with Trade + User metadata
  const adminSupabase = createAdminClient();
  const { data: disputes, error } = await adminSupabase
    .from("disputes")
    .select(`
      *,
      trade:trades (
        id,
        amount,
        crypto_currency,
        fiat_amount,
        fiat_currency,
        buyer_id,
        seller_id,
        status
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return <div className="p-6 text-red-500">Error loading disputes: {error.message}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dispute Resolution Center</h1>
        <p className="text-muted-foreground">
          Review open P2P trade disputes, examine seller/buyer claims, and execute escrow payouts.
        </p>
      </div>

      <DisputeTableClient initialDisputes={disputes || []} />
    </div>
  );
}
