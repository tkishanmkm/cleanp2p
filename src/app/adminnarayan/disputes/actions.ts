"use server";

import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { resolveDisputeAtomically } from "@/lib/admin-dispute-settlement";

/**
 * Dispute resolution shares the same service-role-only atomic settlement
 * boundary as the API route. It remains disabled until the database candidate
 * has passed isolated PostgreSQL replay and concurrency tests.
 */
export async function resolveDispute(input: {
  disputeId: string;
  tradeId: string;
  winnerId: string;
  resolutionReason: string;
}) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    throw new Error("Unauthorized: Administrator privileges required.");
  }
  if (auth.supportAdmin === true) {
    throw new Error("Support administrators cannot resolve disputes or settle escrow.");
  }

  return resolveDisputeAtomically({
    disputeId: input.disputeId,
    tradeId: input.tradeId,
    winnerId: input.winnerId,
    reason: input.resolutionReason,
    actorId: auth.adminId,
    actorEmail: auth.adminEmail || auth.user?.email || null,
  });
}
