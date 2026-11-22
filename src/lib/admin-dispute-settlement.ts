import 'server-only';

import { getSupabaseAdminClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DisputeResolution = 'RELEASE' | 'CANCEL';

export class AdminDisputeSettlementError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AdminDisputeSettlementError';
  }
}

export interface ResolveDisputeAtomicallyInput {
  disputeId?: string;
  tradeId: string;
  winnerId?: string;
  resolution?: DisputeResolution;
  reason: string;
  actorId: string;
  actorEmail?: string | null;
}

/**
 * The single server-side boundary for administrator dispute settlement.
 * The runtime feature flag remains off until this migration has passed an
 * isolated PostgreSQL replay and its concurrency/financial tests.
 */
export async function resolveDisputeAtomically(input: ResolveDisputeAtomicallyInput) {
  if (process.env.PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true') {
    throw new AdminDisputeSettlementError(
      'Dispute settlement is disabled until the atomic database migration has passed isolated PostgreSQL verification.',
      503,
      'DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED',
    );
  }

  const tradeId = String(input.tradeId || '').trim();
  const disputeId = input.disputeId ? String(input.disputeId).trim() : undefined;
  const actorId = String(input.actorId || '').trim();
  const reason = String(input.reason || '').trim();

  if (!UUID_PATTERN.test(tradeId) || (disputeId && !UUID_PATTERN.test(disputeId)) || !UUID_PATTERN.test(actorId)) {
    throw new AdminDisputeSettlementError('A valid trade, dispute, and administrator ID are required.', 400, 'INVALID_DISPUTE_IDENTIFIERS');
  }
  if (reason.length < 10 || reason.length > 2000) {
    throw new AdminDisputeSettlementError('Resolution reason must contain between 10 and 2000 characters.', 400, 'INVALID_DISPUTE_REASON');
  }

  const admin = getSupabaseAdminClient();
  const { data: trade, error: tradeError } = await admin
    .from('trades')
    .select('id, buyer_id, seller_id, status, escrow_status')
    .eq('id', tradeId)
    .maybeSingle();

  if (tradeError) {
    throw new AdminDisputeSettlementError('Unable to verify the trade before settlement.', 503, 'TRADE_LOOKUP_FAILED');
  }
  if (!trade) {
    throw new AdminDisputeSettlementError('Trade not found.', 404, 'TRADE_NOT_FOUND');
  }

  let disputeQuery = admin
    .from('disputes')
    .select('id, trade_id, status')
    .eq('trade_id', tradeId)
    .eq('status', 'open');
  if (disputeId) {
    disputeQuery = admin
      .from('disputes')
      .select('id, trade_id, status')
      .eq('id', disputeId);
  }

  const { data: dispute, error: disputeError } = await disputeQuery.maybeSingle();
  if (disputeError) {
    throw new AdminDisputeSettlementError('Unable to verify the dispute. Multiple or inaccessible dispute records may exist.', 409, 'DISPUTE_LOOKUP_FAILED');
  }
  if (!dispute || String(dispute.trade_id) !== tradeId) {
    throw new AdminDisputeSettlementError('An open dispute for this trade was not found.', 404, 'OPEN_DISPUTE_NOT_FOUND');
  }
  if (!['open', 'resolved'].includes(String(dispute.status || '').toLowerCase())) {
    throw new AdminDisputeSettlementError('Only an open dispute or a verified idempotent replay can be processed.', 409, 'DISPUTE_NOT_OPEN');
  }

  const buyerId = String(trade.buyer_id || '');
  const sellerId = String(trade.seller_id || '');
  let expectedWinnerId: string;
  let resolution: DisputeResolution;

  if (input.resolution) {
    resolution = input.resolution;
    expectedWinnerId = resolution === 'RELEASE' ? buyerId : sellerId;
  } else if (input.winnerId && input.winnerId === buyerId) {
    resolution = 'RELEASE';
    expectedWinnerId = buyerId;
  } else if (input.winnerId && input.winnerId === sellerId) {
    resolution = 'CANCEL';
    expectedWinnerId = sellerId;
  } else {
    throw new AdminDisputeSettlementError('Winner must be exactly the buyer or seller in this trade.', 400, 'INVALID_DISPUTE_WINNER');
  }

  if (!UUID_PATTERN.test(expectedWinnerId) || (input.winnerId && input.winnerId !== expectedWinnerId)) {
    throw new AdminDisputeSettlementError('The requested outcome does not match a verified trade participant.', 403, 'DISPUTE_WINNER_MISMATCH');
  }

  const { data, error } = await admin.rpc('admin_resolve_trade_dispute_atomic', {
    p_dispute_id: dispute.id,
    p_trade_id: tradeId,
    p_winner_id: expectedWinnerId,
    p_actor_id: actorId,
    p_actor_email: input.actorEmail || null,
    p_resolution: reason,
  });

  if (error || !data || data.success !== true || data.settlement_succeeded !== true || data.audit_logged !== true) {
    const errorCode = error?.code || 'DISPUTE_ATOMIC_SETTLEMENT_REJECTED';
    console.error('[admin dispute settlement] Atomic RPC did not confirm settlement and audit.', {
      code: errorCode,
      disputeId: dispute.id,
      tradeId,
    });
    throw new AdminDisputeSettlementError(
      'Atomic dispute settlement was not confirmed. Verify the dispute and escrow state before retrying.',
      error?.code === 'PGRST202' ? 503 : 409,
      error?.code === 'PGRST202' ? 'DISPUTE_ATOMIC_RPC_NOT_INSTALLED' : 'DISPUTE_ATOMIC_SETTLEMENT_REJECTED',
    );
  }

  return {
    success: true as const,
    settlementSucceeded: true as const,
    audit_logged: true as const,
    disputeId: dispute.id,
    tradeId,
    winnerId: expectedWinnerId,
    resolution,
    idempotent: data.idempotent === true,
    messageWritten: data.message_written === true,
    notificationsWritten: data.notifications_written === true,
  };
}
