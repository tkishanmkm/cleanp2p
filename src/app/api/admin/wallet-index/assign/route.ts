import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: "Full administrator access is required to allocate wallet derivation indexes." },
        { status: 403 },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin.rpc("assign_missing_profile_wallet_indexes");

    if (error) {
      console.error("[ADMIN WALLET INDEX] Allocation RPC failed:", error.code || "UNKNOWN");
      const missingRpc = error.code === "PGRST202" || error.code === "42883";
      return NextResponse.json(
        {
          success: false,
          code: missingRpc ? "WALLET_INDEX_ALLOCATOR_NOT_INSTALLED" : "WALLET_INDEX_ALLOCATION_FAILED",
          error: missingRpc
            ? "The approved wallet-index allocation migration must be applied before this operation is available."
            : "Wallet derivation indexes could not be allocated safely. No client-side fallback is permitted.",
        },
        { status: missingRpc ? 503 : 500 },
      );
    }

    const row = Array.isArray(data) ? data[0] : data;
    const assignedCount = Number(row?.assigned_count);
    const lastWalletIndex = row?.last_wallet_index == null ? null : Number(row.last_wallet_index);

    if (!Number.isSafeInteger(assignedCount) || assignedCount < 0 ||
        (lastWalletIndex !== null && (!Number.isSafeInteger(lastWalletIndex) || lastWalletIndex <= 0))) {
      console.error("[ADMIN WALLET INDEX] Allocation RPC returned an invalid response.");
      return NextResponse.json(
        { success: false, code: "WALLET_INDEX_ALLOCATION_INVALID_RESPONSE", error: "The allocator returned an invalid result. Reconciliation is required." },
        { status: 503 },
      );
    }

    const { count: remainingCount, error: remainingError } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .is("wallet_index", null);

    if (remainingError || typeof remainingCount !== "number") {
      console.error("[ADMIN WALLET INDEX] Remaining-profile reconciliation failed:", remainingError?.code || "UNKNOWN");
      return NextResponse.json(
        { success: false, code: "WALLET_INDEX_RECONCILIATION_REQUIRED", error: "The allocation batch completed, but remaining profiles could not be counted. Reconcile before retrying." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      success: true,
      assignedCount,
      lastWalletIndex,
      remainingCount,
      complete: remainingCount === 0,
    });
  } catch (error) {
    console.error("[ADMIN WALLET INDEX] Unexpected allocation failure:", error);
    return NextResponse.json(
      { success: false, error: "Wallet derivation indexes could not be allocated safely." },
      { status: 500 },
    );
  }
}
