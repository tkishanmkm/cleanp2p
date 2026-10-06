import { getSupabaseAdminClient } from '../lib/supabase/admin';

/**
 * Canonical P2P Trade Expiry Worker
 *
 * Invokes the canonical database RPC cancel_expired_p2p_trades().
 * No direct table mutations, ensuring strict double-entry ledger integrity.
 */
export async function processExpiredP2PTrades(): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  const supabase = getSupabaseAdminClient();

  try {
    const { data, error } = await supabase.rpc('cancel_expired_p2p_trades');
    if (error) {
      console.error('[P2P Expiry Worker] cancel_expired_p2p_trades error:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true, data };
  } catch (err: any) {
    console.error('[P2P Expiry Worker] Execution exception:', err?.message);
    return { success: false, error: err?.message };
  }
}


