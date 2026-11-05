import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const LEASE_SECONDS = 60;
const HEARTBEAT_MS = 15_000;

export interface WithdrawalWorkerLease {
  /** Opaque database fencing token; never log or expose to clients. */
  ownerToken: string;
  isLost(): boolean;
  stop(): Promise<void>;
}

/**
 * Uses an owner-token lease stored in Postgres, not a session-scoped advisory
 * lock. PostgREST may route each RPC through a different database session.
 */
export async function acquireWithdrawalWorkerLease(): Promise<WithdrawalWorkerLease | null> {
  const ownerToken = randomUUID();

  try {
    const { data: acquired, error } = await supabaseAdmin.rpc('acquire_withdrawal_worker_lease', {
      p_owner_token: ownerToken,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (error || acquired !== true) return null;
  } catch {
    return null;
  }

  let lost = false;
  let stopped = false;
  let renewalInFlight: Promise<void> | null = null;

  const renew = async (): Promise<void> => {
    if (stopped || lost || renewalInFlight) return;
    renewalInFlight = (async () => {
      try {
        const { data, error } = await supabaseAdmin.rpc('renew_withdrawal_worker_lease', {
          p_owner_token: ownerToken,
          p_lease_seconds: LEASE_SECONDS,
        });
        if (error || data !== true) lost = true;
      } catch {
        lost = true;
      } finally {
        renewalInFlight = null;
      }
    })();
    await renewalInFlight;
  };

  const timer = setInterval(() => { void renew(); }, HEARTBEAT_MS);
  timer.unref?.();

  return {
    ownerToken,
    isLost: () => lost,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      if (renewalInFlight) await renewalInFlight;
      try {
        const { data, error } = await supabaseAdmin.rpc('release_withdrawal_worker_lease', {
          p_owner_token: ownerToken,
        });
        if (error || data !== true) {
          console.warn('[Withdrawal Worker Lease] Owner release was not confirmed; lease will expire.');
        }
      } catch {
        console.warn('[Withdrawal Worker Lease] Release unavailable; lease will expire.');
      }
    },
  };
}
