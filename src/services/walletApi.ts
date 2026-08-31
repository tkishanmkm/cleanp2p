/**
 * Wallet API Service Client
 * Provides helper utilities for deposit address provisioning, transfers, and balances.
 */

export interface ProvisionAddressResponse {
  success: boolean;
  address?: string;
  chain?: string;
  network?: string;
  asset?: string;
  error?: string;
}

/**
 * Maps cryptocurrency and network names to canonical provisioning chain:
 * - BNB / ETH / ERC20 / BEP20 / EVM -> "EVM"
 * - BTC -> "BTC"
 * - LTC -> "LTC"
 * - TRX / USDT-TRC20 / TRON -> "TRON"
 */
export function mapToProvisioningChain(asset: string, network?: string): 'EVM' | 'BTC' | 'LTC' | 'TRON' {
  const normAsset = (asset || '').toUpperCase().trim();
  const normNet = (network || '').toUpperCase().trim();

  if (normNet === 'BTC' || normAsset === 'BTC') return 'BTC';
  if (normNet === 'LTC' || normAsset === 'LTC') return 'LTC';
  if (
    normNet === 'TRC20' ||
    normNet === 'TRON' ||
    normNet === 'TRX' ||
    normNet === 'USDT-TRC20' ||
    normNet === 'USDT_TRC20' ||
    normAsset === 'TRX'
  ) {
    return 'TRON';
  }

  return 'EVM';
}

/**
 * Provisions or retrieves a user's unique custodial deposit address
 */
export async function provisionDepositAddress(
  chainOrAsset: string,
  network?: string
): Promise<ProvisionAddressResponse> {
  const chain = mapToProvisioningChain(chainOrAsset, network);

  try {
    const res = await fetch('/api/wallets/provision-address', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        chain,
        asset: chainOrAsset,
        network: network || chain,
      }),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error("provisionDepositAddress client error:", err);
    return {
      success: false,
      error: err?.message || 'Failed to connect to wallet provisioning service.',
    };
  }
}
