"use server";

import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { resolveDisputeAtomically } from "@/lib/admin-dispute-settlement";

/**
 * Resolve a trade only through its unique open dispute. This keeps the legacy
 * trade-table action from reaching participant escrow RPCs with a browser actor.
 */
export async function resolveTradeAction(
  tradeId: string,
  decision: "release" | "refund",
) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return {
      success: false,
      error: "Unauthorized: Administrator privileges required.",
    };
  }
  if (auth.supportAdmin === true) {
    return {
      success: false,
      error: "Support administrators cannot resolve disputes or settle escrow.",
    };
  }

  try {
    const result = await resolveDisputeAtomically({
      tradeId,
      resolution: decision === "release" ? "RELEASE" : "CANCEL",
      reason: `Administrative dispute resolution: escrow ${decision === "release" ? "released to buyer" : "refunded to seller"}.`,
      actorId: auth.adminId,
      actorEmail: auth.adminEmail || auth.user?.email || null,
    });
    return { ...result, error: undefined };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Atomic dispute settlement was rejected.",
    };
  }
}
