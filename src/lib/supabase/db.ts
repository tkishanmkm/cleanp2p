import { supabase } from './client';

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
 * Invokes the request_withdrawal RPC to lock balance and schedule withdrawal.
 */
export async function requestWithdrawal(
  assetCode: string,
  networkCode: string,
  destinationAddress: string,
  amount: number,
  idempotencyKey: string
): Promise<RpcResponse<{ success: boolean; withdrawal_id: string; amount: number; network_fee: number; status: string }>> {
  try {
    const { data, error } = await supabase.rpc('request_withdrawal', {
      p_asset_code: assetCode,
      p_network_code: networkCode,
      p_destination_address: destinationAddress,
      p_amount: amount,
      p_idempotency_key: idempotencyKey,
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
    // 1. Direct query from wallet_assets by user_id
    const { data: directAssets } = await supabase
      .from('wallet_assets')
      .select('asset_symbol, available, locked, updated_at')
      .eq('user_id', userId);

    if (directAssets && directAssets.length > 0) {
      return {
        data: {
          id: userId,
          user_id: userId,
          status: 'active',
          provisioning_status: 'completed',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          balances: directAssets.map((a: any) => ({
            wallet_id: userId,
            asset_code: a.asset_symbol || '',
            available: Number(a.available || 0),
            locked_escrow: Number(a.locked || 0),
            locked_withdrawal: 0,
            updated_at: a.updated_at || new Date().toISOString(),
          })),
        },
        error: null,
      };
    }

    const { data: walletData, error: walletError } = await supabase
      .from('wallets')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (walletError && walletError.code !== 'PGRST116') {
      return { data: null, error: new Error(walletError.message) };
    }

    if (walletData) {
      const { data: balancesData } = await supabase
        .from('wallet_assets')
        .select('*')
        .eq('wallet_id', walletData.id);

      return {
        data: {
          ...walletData,
          balances: (balancesData || []).map((b: any) => ({
            ...b,
            asset_code: b.asset_symbol || b.asset_code,
            available: Number(b.available || b.balance || 0),
            locked_escrow: Number(b.locked || b.locked_escrow || 0),
            locked_withdrawal: Number(b.locked_withdrawal || 0),
          })),
        },
        error: null,
      };
    }

    return { data: null, error: null };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Fetches deposit transaction history for a given user.
 */
export async function getUserDeposits(userId: string): Promise<RpcResponse<DepositRecord[]>> {
  try {
    const { data, error } = await supabase
      .from('deposits')
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

export interface PlatformWalletRecord {
  id: string;
  asset_code: string;
  network_code: string;
  wallet_type: 'hot' | 'warm' | 'cold';
  public_address: string;
  current_balance: number;
  status: 'active' | 'maintenance' | 'deprecated';
  created_at: string;
  updated_at: string;
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
  platformWallets: PlatformWalletRecord[];
}

/**
 * Fetches admin system metrics: user wallet counts, multi-currency aggregated balances,
 * address provisioning queue statuses, and active platform custody addresses.
 */
export async function getAdminWalletOverview(): Promise<RpcResponse<AdminWalletMetrics>> {
  try {
    // 1. Query wallets
    const { data: walletsData, error: walletsError } = await supabase
      .from('wallets')
      .select('id, user_id, status, provisioning_status');

    if (walletsError) {
      return { data: null, error: new Error(walletsError.message) };
    }

    const totalWallets = (walletsData || []).length;

    // 2. Query aggregate asset balances
    const { data: assetsData, error: assetsError } = await supabase
      .from('wallet_assets')
      .select('asset_code, available, locked_escrow, locked_withdrawal');

    const totalBalances: Record<string, { available: number; locked_escrow: number; locked_withdrawal: number }> = {
      BTC: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      ETH: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      LTC: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
      USDT: { available: 0, locked_escrow: 0, locked_withdrawal: 0 },
    };

    if (!assetsError && assetsData) {
      assetsData.forEach((row: { asset_code: string; available: number; locked_escrow: number; locked_withdrawal: number }) => {
        const code = row.asset_code?.toUpperCase();
        if (!totalBalances[code]) {
          totalBalances[code] = { available: 0, locked_escrow: 0, locked_withdrawal: 0 };
        }
        totalBalances[code].available += Number(row.available || 0);
        totalBalances[code].locked_escrow += Number(row.locked_escrow || 0);
        totalBalances[code].locked_withdrawal += Number(row.locked_withdrawal || 0);
      });
    }

    // 3. Provisioning queue stats
    const queueStats: ProvisioningQueueMetrics = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      total_users: totalWallets,
      provisioned_wallets: 0,
    };

    (walletsData || []).forEach(w => {
      const status = w.provisioning_status || 'pending';
      if (status === 'pending') queueStats.queued++;
      else if (status === 'in_progress') queueStats.processing++;
      else if (status === 'completed') {
        queueStats.completed++;
        queueStats.provisioned_wallets++;
      } else if (status === 'failed') queueStats.failed++;
    });

    // 4. Platform custody wallets
    const { data: platformWalletsData, error: platformError } = await supabase
      .from('platform_wallets')
      .select('*')
      .order('asset_code', { ascending: true });

    if (platformError) {
      return { data: null, error: new Error(platformError.message) };
    }

    return {
      data: {
        totalWallets,
        totalBalances,
        provisioningQueue: queueStats,
        platformWallets: platformWalletsData || [],
      },
      error: null,
    };
  } catch (err: unknown) {
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
