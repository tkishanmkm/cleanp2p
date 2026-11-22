import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeDepositAddressForLookup,
  resolveDepositAddressOwnerFromRows,
  type DepositAddressOwnerRow,
} from './deposit-address-owner';

/**
 * Resolve an address owner across both the canonical HD registry and the
 * legacy chain-address registry. Call only from an authenticated server route
 * using a service-role client; never expose either table to cross-user browser
 * reads.
 */
export async function resolveDepositAddressOwner(
  adminClient: SupabaseClient,
  input: unknown
): Promise<string | null> {
  const normalized = normalizeDepositAddressForLookup(input);
  if (!normalized) return null;

  const queryAddress = normalized.value;
  const legacyQuery = adminClient
    .from('deposit_addresses')
    .select('user_id, address')
    .limit(25);
  const canonicalQuery = adminClient
    .from('user_deposit_addresses')
    .select('user_id, address')
    .limit(25);

  const [legacyResult, canonicalResult] = await Promise.all([
    normalized.caseInsensitive
      ? legacyQuery.ilike('address', queryAddress)
      : legacyQuery.eq('address', queryAddress),
    normalized.caseInsensitive
      ? canonicalQuery.ilike('address', queryAddress)
      : canonicalQuery.eq('address', queryAddress),
  ]);

  if (legacyResult.error || canonicalResult.error) {
    throw new Error('Deposit-address ownership could not be verified.');
  }

  const rows = [
    ...((legacyResult.data || []) as DepositAddressOwnerRow[]),
    ...((canonicalResult.data || []) as DepositAddressOwnerRow[]),
  ];

  return resolveDepositAddressOwnerFromRows(input, rows);
}
