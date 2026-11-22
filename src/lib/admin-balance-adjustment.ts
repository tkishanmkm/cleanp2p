import 'server-only';

import { getSupabaseAdminClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_ASSETS = new Set(['BTC', 'ETH', 'LTC', 'USDT', 'BNB', 'TRX']);

export class AdminBalanceAdjustmentError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AdminBalanceAdjustmentError';
  }
}

export interface AdminBalanceAdjustmentInput {
  adminId: string;
  adminEmail?: string | null;
  targetUserId: string;
  asset: string;
  action: 'add' | 'subtract';
  amount: number;
  reason: string;
  requestId: string;
}

/** Service-role-only, idempotent admin adjustment. Feature flag stays off until
 * the SQL candidate has passed isolated PostgreSQL replay and balance fixtures. */
export async function adjustAdminWalletBalance(input: AdminBalanceAdjustmentInput) {
  if (process.env.PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED !== 'true') {
    throw new AdminBalanceAdjustmentError(
      'Admin balance adjustment is disabled until the atomic ledger migration passes isolated PostgreSQL verification.',
      503,
      'ADMIN_BALANCE_ATOMIC_UNVERIFIED',
    );
  }

  if (
    !UUID_PATTERN.test(input.adminId) ||
    !UUID_PATTERN.test(input.targetUserId) ||
    !UUID_PATTERN.test(input.requestId)
  ) {
    throw new AdminBalanceAdjustmentError('Valid administrator, target-user, and request IDs are required.', 400, 'INVALID_ADJUSTMENT_IDENTIFIERS');
  }

  const asset = String(input.asset || '').trim().toUpperCase();
  const action = String(input.action || '').trim().toLowerCase();
  const reason = String(input.reason || '').trim();

  if (!SUPPORTED_ASSETS.has(asset)) {
    throw new AdminBalanceAdjustmentError('Unsupported wallet asset.', 400, 'UNSUPPORTED_ADJUSTMENT_ASSET');
  }
  if (action !== 'add' && action !== 'subtract') {
    throw new AdminBalanceAdjustmentError('Action must be add or subtract.', 400, 'INVALID_ADJUSTMENT_ACTION');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || Number(input.amount.toFixed(8)) !== input.amount) {
    throw new AdminBalanceAdjustmentError('Amount must be positive with at most 8 decimal places.', 400, 'INVALID_ADJUSTMENT_AMOUNT');
  }
  if (reason.length < 10 || reason.length > 1000) {
    throw new AdminBalanceAdjustmentError('Reason must contain between 10 and 1000 characters.', 400, 'INVALID_ADJUSTMENT_REASON');
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase.rpc('admin_adjust_balance_atomic', {
    p_admin_id: input.adminId,
    p_target_user_id: input.targetUserId,
    p_asset: asset,
    p_action: action,
    p_amount: input.amount,
    p_reason: reason,
    p_request_id: input.requestId,
  });

  if (error) {
    const unavailable = error.code === 'PGRST202' || error.code === '42883';
    console.error('[admin balance adjustment] Atomic RPC failed.', {
      code: error.code || 'UNKNOWN',
      targetUserId: input.targetUserId,
      requestId: input.requestId,
    });
    throw new AdminBalanceAdjustmentError(
      unavailable
        ? 'Atomic balance adjustment is not installed in the database yet.'
        : 'Balance adjustment was rejected. Verify the wallet and ledger state before retrying.',
      unavailable ? 503 : 409,
      unavailable ? 'ADMIN_BALANCE_ATOMIC_RPC_NOT_INSTALLED' : 'ADMIN_BALANCE_ADJUSTMENT_REJECTED',
    );
  }

  if (!data || data.success !== true || data.audit_logged !== true) {
    throw new AdminBalanceAdjustmentError(
      'The database did not confirm both the balance adjustment and its audit record.',
      409,
      'ADMIN_BALANCE_ADJUSTMENT_UNCONFIRMED',
    );
  }

  return {
    success: true as const,
    audit_logged: true as const,
    idempotent: data.idempotent === true,
    requestId: input.requestId,
    asset,
    action,
    amount: input.amount,
    balanceAfter: data.new_balance ?? data.balance_after ?? null,
    ledgerEntryId: data.ledger_entry_id ?? null,
  };
}
