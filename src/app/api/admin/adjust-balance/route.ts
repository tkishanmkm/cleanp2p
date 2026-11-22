import { NextRequest, NextResponse } from "next/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

/**
 * Financial safety interlock.
 * The production ledger schema has not been reconciled with the canonical
 * ledger contract, and the previous handler performed independent writes.
 * Keep this mutation disabled until a schema-verified atomic RPC is available.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyServerAdmin(req);
  if (!auth.authorized) return auth.response!;

  return NextResponse.json(
    {
      success: false,
      error: "Manual balance adjustments are temporarily disabled pending atomic ledger support.",
      code: "ADMIN_BALANCE_ADJUSTMENT_UNAVAILABLE",
    },
    { status: 503 },
  );
}
