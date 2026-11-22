import { supabase } from './client';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export interface WalletAssetBalance {
  wallet_id: string;
  asset_code: string;
  available: number;
  locked_escrow: number;
  locked_withdrawal: number;
  updated_at: string;
}

export interface UserWallet {
  id: string;
  user_id: string;
  status: 'active' | 'suspended' | 'closed';
  provisioning_status: 'pending' | 'in_progress' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  balances?: WalletAssetBalance[];
}

export interface DepositRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  asset_code: string;
  network_code: string;
  deposit_address_id?: string | null;
  amount: number;
  txid: string;
  output_index: number;
  confirmations: number;
  status: 'detected' | 'pending' | 'confirmed' | 'credited' | 'rejected';
  credited_at?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface WithdrawalRecord {
  id: string;
  user_id: string;
  wallet_id: string;
  asset_code: string;
  network_code: string;
  destination_address: string;
  amount: number;
  network_fee: number;
  status: 'pending' | 'approved' | 'broadcasting' | 'broadcasted' | 'completed' | 'rejected' | 'cancelled';
  platform_wallet_id?: string | null;
  txid?: string | null;
  approved_by?: string | null;
  rejected_reason?: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface DepositAddressRecord {
  id: string;
  wallet_id: string;
  user_id: string;
  asset_code: string;
  network_code: string;
  address: string;
  custody_provider: string;
  status: 'active' | 'retired' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface RpcResponse<T = unknown> {
  data: T | null;
  error: Error | null;
}

/**
 * Invokes the canonical server-side withdrawal endpoint.
 */
export async function requestWithdrawal(
  assetCode: string,
  networkCode: string,
  destinationAddress: string,
  amount: number,
  idempotencyKey: string,
  totpCode?: string
): Promise<RpcResponse<{ success: boolean; withdrawal_id: string; amount: number; network_fee: number; status: string }>> {
  try {
    const res = await fetch('/api/withdraw', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({
        asset: assetCode,
        network: networkCode,
        destinationAddress,
        amount,
        totpCode,
      }),
    });

    const resData = await res.json();
    if (!res.ok) {
      return { data: null, error: new Error(resData.error || 'Withdrawal failed') };
    }

    return {
      data: {
        success: true,
        withdrawal_id: resData.withdrawalId,
        amount: resData.amountRequested,
        network_fee: resData.networkFee,
        status: resData.status,
      },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Invokes the complete_trade RPC to atomically release escrow and credit buyer.
 */
export async function completeTrade(
  tradeId: string
): Promise<RpcResponse<{ success: boolean; trade_id: string; credited_amount: number; fee: number; status: string }>> {
  try {
    const { data, error } = await supabase.rpc('complete_trade', {
      p_trade_id: tradeId,
    });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches user wallet record along with associated multi-currency balances.
 */
export async function getUserWallets(userId: string): Promise<RpcResponse<UserWallet | null>> {
  try {
    if (!userId) {
      return { data: null, error: new Error('A user ID is required to load wallet balances.') };
    }

    // WAYONES provisions four chain-specific rows in public.wallets, while
    // public.wallet_assets is keyed by (user_id, asset_symbol). Read the
    // authoritative asset rows directly; never assume one wallet row per user
    // or a wallet_id foreign key on wallet_assets.
    const { data: assetRows, error } = await supabase
      .from('wallet_assets')
      .select('asset_symbol, balance, locked_balance, reserved_balance, in_escrow, in_withdrawal, created_at, updated_at')
      .eq('user_id', userId)
      .order('asset_symbol', { ascending: true });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    if (!Array.isArray(assetRows) || assetRows.length === 0) {
      return { data: null, error: null };
    }

    const now = new Date().toISOString();
    const balances: WalletAssetBalance[] = assetRows.map((row: any) => {
      const normalized = normalizePrimaryWalletAssetBalance(row);
      return {
        wallet_id: userId,
        asset_code: String(row.asset_symbol || '').trim().toUpperCase(),
        available: normalized.available,
        locked_escrow: normalized.inEscrow,
        locked_withdrawal: normalized.inWithdrawal,
        updated_at: typeof row.updated_at === 'string' ? row.updated_at : now,
      };
    }).filter((row) => Boolean(row.asset_code));

    if (balances.length === 0) {
      return { data: null, error: null };
    }

    const createdTimestamps = assetRows
      .map((row: any) => row.created_at)
      .filter((value: unknown): value is string => typeof value === 'string')
      .sort();
    const updatedTimestamps = assetRows
      .map((row: any) => row.updated_at)
      .filter((value: unknown): value is string => typeof value === 'string')
      .sort();

    return {
      data: {
        id: userId,
        user_id: userId,
        status: 'active',
        provisioning_status: 'completed',
        created_at: createdTimestamps[0] || now,
        updated_at: updatedTimestamps[updatedTimestamps.length - 1] || now,
        balances,
      },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches deposit transaction history for a given user.
 */
export async function getUserDeposits(userId: string): Promise<RpcResponse<DepositRecord[]>> {
  try {
    // 1. Try server-side API first for complete historical merge
    if (typeof window !== 'undefined') {
      try {
        const res = await fetch(`/api/wallet/history/deposits?user_id=${encodeURIComponent(userId)}&limit=50`);
        if (res.ok) {
          const json = await res.json();
          if (json.data && Array.isArray(json.data)) {
            const mapped: DepositRecord[] = json.data.map((d: any) => ({
              id: d.id,
              user_id: d.user_id,
              wallet_id: d.wallet_id || '',
              asset_code: d.asset_symbol || d.asset_code || d.asset || 'USDT',
              network_code: d.network || d.network_code || d.chain || 'EVM',
              deposit_address_id: d.address || d.to_address || null,
              amount: Number(d.amount || 0),
              txid: d.tx_hash || d.txid || '',
              output_index: d.output_index || 0,
              confirmations: d.confirmations || 0,
              status: d.status || 'confirmed',
              credited_at: d.credited_at || null,
              idempotency_key: d.idempotency_key || '',
              created_at: d.created_at,
              updated_at: d.updated_at || d.created_at,
            }));
            return { data: mapped, error: null };
          }
        }
      } catch (apiErr) {
        console.warn('API fetch failed, falling back to direct supabase query:', apiErr);
      }
    }

    // 2. Direct Supabase query (onchain_deposits + deposits)
    const [onchainRes, depositsRes] = await Promise.all([
      supabase.from('onchain_deposits').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabase.from('deposits').select('*').eq('user_id', userId).order('created_at', { ascending: false })
    ]);

    if (onchainRes.error || depositsRes.error) {
      return {
        data: null,
        error: new Error('Unable to load canonical deposit history.'),
      };
    }

    const combined: DepositRecord[] = [];
    const seenDepositIdentities = new Set<string>();
    const getDepositIdentity = (row: any, source: 'onchain' | 'legacy'): string => {
      const tx = String(row.tx_hash || row.txid || '').trim().toLowerCase();
      if (!tx) return source + ':' + String(row.id || '');
      const network = String(row.network || row.network_code || row.chain || '').trim().toUpperCase();
      const outputIndex = Number.isSafeInteger(Number(row.output_index)) ? Number(row.output_index) : 0;
      return [network, tx, String(outputIndex)].join(':');
    };

    if (onchainRes.data) {
      for (const d of onchainRes.data) {
        const identity = getDepositIdentity(d, 'onchain');
        if (seenDepositIdentities.has(identity)) continue;
        seenDepositIdentities.add(identity);
        combined.push({
          id: d.id,
          user_id: d.user_id,
          wallet_id: d.wallet_id || '',
          asset_code: (d.asset_symbol || d.asset || d.asset_code || 'USDT').toUpperCase(),
          network_code: (d.network || d.network_code || d.chain || 'EVM').toUpperCase(),
          deposit_address_id: d.address || d.to_address || null,
          amount: Number(d.amount || 0),
          txid: d.tx_hash || d.txid || '',
          output_index: d.output_index || 0,
          confirmations: d.confirmations || 0,
          status: (d.status || 'confirmed').toLowerCase() as any,
          credited_at: d.credited_at || null,
          idempotency_key: d.idempotency_key || '',
          created_at: d.created_at,
          updated_at: d.updated_at || d.created_at,
        });
      }
    }

    if (depositsRes.data) {
      for (const d of depositsRes.data) {
        const identity = getDepositIdentity(d, 'legacy');
        if (!seenDepositIdentities.has(identity)) {
          seenDepositIdentities.add(identity);
          combined.push({
            id: d.id,
            user_id: d.user_id,
            wallet_id: d.wallet_id || '',
            asset_code: (d.token_symbol || d.asset || d.asset_code || 'USDT').toUpperCase(),
            network_code: (d.chain || d.network || d.network_code || 'EVM').toUpperCase(),
            deposit_address_id: d.to_address || d.address || null,
            amount: Number(d.amount || 0),
            txid: d.tx_hash || d.txid || '',
            output_index: d.output_index || 0,
            confirmations: 0,
            status: (d.status || 'confirmed').toLowerCase() as any,
            credited_at: d.created_at || null,
            idempotency_key: d.idempotency_key || '',
            created_at: d.created_at,
            updated_at: d.updated_at || d.created_at,
          });
        }
      }
    }

    // Sort descending by created_at
    combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return { data: combined, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches withdrawal transaction history for a given user.
 */
export async function getUserWithdrawals(userId: string): Promise<RpcResponse<WithdrawalRecord[]>> {
  try {
    const { data, error } = await supabase
      .from('withdrawals')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || [], error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches the active deposit address for a given user, asset, and network.
 */
export async function getActiveDepositAddress(
  userId: string,
  assetCode: string,
  networkCode: string
): Promise<RpcResponse<DepositAddressRecord | null>> {
  try {
    const { data, error } = await supabase
      .from('deposit_addresses')
      .select('*')
      .eq('user_id', userId)
      .eq('asset_code', assetCode)
      .eq('network_code', networkCode)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      return { data: null, error: new Error(error.message) };
    }

    return { data: data || null, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

export interface PlatformCustodyBalanceRecord {
  id: string;
  currency: string;
  balance: number;
  updated_at: string | null;
  type: string;
}

export interface ProvisioningQueueMetrics {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total_users: number;
  provisioned_wallets: number;
}

export interface AdminWalletMetrics {
  totalWallets: number;
  totalBalances: Record<string, { available: number; locked_escrow: number; locked_withdrawal: number }>;
  provisioningQueue: ProvisioningQueueMetrics;
  platformWallets: PlatformCustodyBalanceRecord[];
  totalDeposits?: { totalCount: number; byCurrency: Record<string, { count: number; volume: number }> };
  totalWithdrawals?: { totalCount: number; byCurrency: Record<string, { count: number; volume: number }> };
  totalUsers?: number;
  totalDepositAddresses?: number;
  custodyAvailable?: boolean;
}

/**
 * Loads the full-admin wallet summary from the server-only financial API.
 * No browser-side service role or cross-user table fallback is permitted.
 */
export async function getAdminWalletOverview(): Promise<RpcResponse<AdminWalletMetrics>> {
  try {
    const response = await fetch('/api/admin/wallets', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success || !payload?.metrics || !Array.isArray(payload.systemBalances)) {
      return {
        data: null,
        error: new Error(payload?.error || 'Platform wallet metrics could not be verified.'),
      };
    }

    const totalBalances: AdminWalletMetrics['totalBalances'] = {};
    for (const row of payload.systemBalances) {
      const currency = String(row.currency || '').trim().toUpperCase();
      if (!currency) continue;
      totalBalances[currency] = {
        available: Number(row.available || 0),
        locked_escrow: Number(row.escrow || 0),
        locked_withdrawal: Number(row.pendingWithdrawal || 0),
      };
    }

    const provisioningQueue: ProvisioningQueueMetrics = {
      queued: 0,
      processing: 0,
      completed: Number(payload.metrics.totalDepositAddresses || 0),
      failed: 0,
      total_users: Number(payload.metrics.totalUsers || 0),
      provisioned_wallets: Number(payload.metrics.totalDepositAddresses || 0),
    };

    return {
      data: {
        totalWallets: Number(payload.metrics.totalUserWallets || 0),
        totalBalances,
        provisioningQueue,
        platformWallets: Array.isArray(payload.platformCustody) ? payload.platformCustody : [],
        totalDeposits: payload.totalDeposits,
        totalWithdrawals: payload.totalWithdrawals,
        totalUsers: Number(payload.metrics.totalUsers || 0),
        totalDepositAddresses: Number(payload.metrics.totalDepositAddresses || 0),
        custodyAvailable: payload.custodyAvailable === true,
      },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
