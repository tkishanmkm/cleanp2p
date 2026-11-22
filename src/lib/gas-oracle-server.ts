import 'server-only';

import { fetchNetworkGasFeeEstimates, type NetworkGasFee } from '@/lib/gas-oracle';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

/** Server-only gas-oracle refresh. A missing service key is a hard failure. */
export async function fetchAndCacheNetworkGasFees(): Promise<NetworkGasFee[]> {
  const results = await fetchNetworkGasFeeEstimates();
  const admin = getSupabaseAdminClient();

  const rows = results.map((record) => ({
    id: `${record.crypto.toLowerCase()}_${record.network.toLowerCase()}`,
    crypto: record.crypto,
    network: record.network,
    base_fee_gwei: record.base_fee_gwei ?? null,
    priority_fee_gwei: record.priority_fee_gwei ?? null,
    sat_per_vbyte: record.sat_per_vbyte ?? null,
    estimated_fee_native: record.estimated_fee_native,
    estimated_fee_usd: record.estimated_fee_usd,
    updated_at: record.updated_at,
  }));

  const { error } = await admin
    .from('network_gas_fees')
    .upsert(rows, { onConflict: 'id' });

  if (error) {
    console.error('[Gas Oracle] Failed to persist network_gas_fees:', error.message);
    throw new Error('Gas fee estimates were calculated but could not be fully persisted.');
  }

  return results;
}
