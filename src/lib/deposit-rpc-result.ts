export interface DepositRpcResult {
  success: boolean;
  status: string | null;
  credited: boolean;
  alreadyCredited: boolean;
  code: string | null;
  message: string | null;
  raw: Record<string, unknown> | null;
}

/**
 * Parse the canonical pending/confirmation RPC response without trusting a
 * status string on its own. A malformed or legacy response fails closed.
 */
export function parseDepositRpcResult(data: unknown): DepositRpcResult {
  let parsed: unknown = data;

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {
        success: false,
        status: null,
        credited: false,
        alreadyCredited: false,
        code: 'INVALID_RPC_JSON',
        message: 'Deposit RPC returned malformed JSON.',
        raw: null,
      };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      success: false,
      status: null,
      credited: false,
      alreadyCredited: false,
      code: 'INVALID_RPC_RESPONSE',
      message: 'Deposit RPC returned no structured result.',
      raw: null,
    };
  }

  const raw = parsed as Record<string, unknown>;
  return {
    success: raw.success === true,
    status: typeof raw.status === 'string' ? raw.status : null,
    credited: raw.credited === true,
    alreadyCredited: raw.already_credited === true,
    code: typeof raw.code === 'string' ? raw.code : null,
    message: typeof raw.message === 'string' ? raw.message : null,
    raw,
  };
}
