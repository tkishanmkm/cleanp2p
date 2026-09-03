import { createClient } from '@supabase/supabase-js';
import { ethers } from 'ethers';
import { getUsdtConfig } from '../lib/constants';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function resolveHotWalletAddress(): string {
  if (process.env.HOT_WALLET_PUBLIC_ADDRESS) {
    return process.env.HOT_WALLET_PUBLIC_ADDRESS;
  }
  if (process.env.EVM_HOT_WALLET_ADDRESS) {
    return process.env.EVM_HOT_WALLET_ADDRESS;
  }
  const privKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  if (privKey) {
    try {
      const formattedKey = privKey.startsWith('0x') ? privKey : `0x${privKey}`;
      return new ethers.Wallet(formattedKey).address;
    } catch (_) {}
  }
  return '0x71C80a6c6a46C652136e095b3d5bfa780d6D33A4';
}

function resolveMasterPrivateKey(): string {
  const privKey = process.env.HOT_WALLET_PRIVATE_KEY || process.env.EVM_HOT_WALLET_PRIVATE_KEY || '';
  if (privKey && !privKey.startsWith('0x') && privKey.length === 64) {
    return `0x${privKey}`;
  }
  return privKey;
}

const HOT_WALLET_ADDRESS = resolveHotWalletAddress();
const MASTER_SEED_OR_PRIV_KEY = resolveMasterPrivateKey();

// Minimum threshold before sweeping to avoid wasting gas on tiny dust
export const MIN_SWEEP_THRESHOLD_USDT = 10.0;

export interface SweepResult {
  address: string;
  network: string;
  amountSwept: string;
  txHash: string;
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
  error?: string;
}

export function getRpcUrlForNetwork(network: string): string {
  switch (network.toUpperCase()) {
    case 'ERC20':
    case 'ETH':
    case 'ETHEREUM':
      return process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
    case 'BEP20':
    case 'BSC':
    case 'BINANCE':
      return process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org';
    case 'POLYGON':
    case 'MATIC':
      return process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
    case 'TRC20':
    case 'TRON':
      return process.env.TRON_RPC_URL || 'https://api.trongrid.io';
    default:
      throw new Error(`Unsupported RPC network: ${network}`);
  }
}

/**
 * Derives the child wallet for a given index.
 * Uses HDNodeWallet derivation for EVM chains or private key mapping.
 */
export function getDerivedEVMWallet(derivationIndex: number, provider: ethers.Provider): ethers.HDNodeWallet {
  // Derivation path for custom derived deposit addresses
  const path = `m/44'/60'/0'/0/${derivationIndex}`;
  const mnemonic = process.env.DEPOSIT_HD_MNEMONIC;
  
  if (!mnemonic) {
    throw new Error('DEPOSIT_HD_MNEMONIC is not configured in environment');
  }

  const hdNode = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(mnemonic.trim()), path);
  return hdNode.connect(provider);
}

/**
 * Top-up small amount of native gas (ETH/BNB/POL) from Hot Wallet to Deposit Address.
 */
export async function fundGasForAddress(
  targetAddress: string,
  amountWei: bigint,
  provider: ethers.Provider
) {
  if (!MASTER_SEED_OR_PRIV_KEY) {
    throw new Error('MASTER_SEED_OR_PRIV_KEY is not configured in environment');
  }
  const formattedKey = MASTER_SEED_OR_PRIV_KEY.startsWith('0x')
    ? MASTER_SEED_OR_PRIV_KEY
    : `0x${MASTER_SEED_OR_PRIV_KEY}`;
  const masterWallet = new ethers.Wallet(formattedKey, provider);
  const tx = await masterWallet.sendTransaction({
    to: targetAddress,
    value: amountWei,
  });
  await tx.wait(1);
}

/**
 * Sweeps confirmed deposits from a user address to the central Hot Wallet.
 */
export async function sweepUserDepositAddress(
  depositAddress: string,
  network: 'ERC20' | 'BEP20' | 'POLYGON' | 'TRC20',
  derivationIndex: number
): Promise<SweepResult> {
  try {
    const tokenConfig = getUsdtConfig(network);
    const rpcUrl = getRpcUrlForNetwork(network);
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const derivedWallet = getDerivedEVMWallet(derivationIndex, provider);

    // Verify derived address matches expected address
    if (derivedWallet.address.toLowerCase() !== depositAddress.toLowerCase()) {
      throw new Error(`Address mismatch: Derived ${derivedWallet.address} != Expected ${depositAddress}`);
    }

    // Initialize ERC20 Contract attached to the derived child wallet
    const erc20Abi = [
      'function balanceOf(address owner) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ];
    const tokenContract = new ethers.Contract(tokenConfig.contractAddress, erc20Abi, derivedWallet);

    // Check token balance on the user address
    const balanceRaw: bigint = await tokenContract.balanceOf(depositAddress);
    const balanceFormatted = parseFloat(ethers.formatUnits(balanceRaw, tokenConfig.decimals));

    if (balanceFormatted < MIN_SWEEP_THRESHOLD_USDT) {
      return {
        address: depositAddress,
        network,
        amountSwept: balanceFormatted.toString(),
        txHash: '',
        status: 'SKIPPED',
        error: `Balance ${balanceFormatted} below sweep threshold ${MIN_SWEEP_THRESHOLD_USDT}`,
      };
    }

    // Ensure user address has sufficient native gas tokens (ETH/BNB/POL)
    const nativeGasBalance = await provider.getBalance(depositAddress);
    const feeData = await provider.getFeeData();
    const estimatedGasPrice = feeData.gasPrice || ethers.parseUnits('20', 'gwei');
    const estimatedGasLimit = BigInt(65000); // Standard ERC20 transfer gas limit
    const requiredGasFee = estimatedGasPrice * estimatedGasLimit;

    if (nativeGasBalance < requiredGasFee) {
      console.log(`[Sweeper] Funding gas for address ${depositAddress}...`);
      await fundGasForAddress(depositAddress, requiredGasFee - nativeGasBalance, provider);
    }

    // Execute transfer to central Hot Wallet
    console.log(`[Sweeper] Sweeping ${balanceFormatted} ${network} USDT from ${depositAddress} to ${HOT_WALLET_ADDRESS}`);
    const tx = await tokenContract.transfer(HOT_WALLET_ADDRESS, balanceRaw);
    const receipt = await tx.wait(1);

    return {
      address: depositAddress,
      network,
      amountSwept: balanceFormatted.toString(),
      txHash: receipt.hash,
      status: 'SUCCESS',
    };
  } catch (err: any) {
    console.error(`[Sweeper Error] Failed sweeping ${depositAddress} on ${network}:`, err);
    return {
      address: depositAddress,
      network,
      amountSwept: '0',
      txHash: '',
      status: 'FAILED',
      error: err.message,
    };
  }
}

/**
 * Scans DB for confirmed deposits that have not yet been swept.
 */
export async function runAutomatedSweeperJob(): Promise<SweepResult[]> {
  // Query pending unswept deposits joined with user derivation indexes
  let unsweptDeposits: any[] = [];

  const { data: deposits, error } = await supabaseAdmin
    .from('onchain_deposits')
    .select('id, address, to_address, network, user_id')
    .eq('status', 'CONFIRMED')
    .eq('is_swept', false)
    .limit(20);

  if (!error && deposits) {
    unsweptDeposits = deposits;
  } else if (error) {
    // Fallback query if 'address' or 'is_swept' column is conditionally resolved
    const { data: fallbackDeposits } = await supabaseAdmin
      .from('onchain_deposits')
      .select('id, to_address, network, user_id')
      .eq('status', 'CONFIRMED')
      .limit(20);
    unsweptDeposits = fallbackDeposits || [];
  }

  if (!unsweptDeposits || unsweptDeposits.length === 0) {
    return [];
  }

  const results: SweepResult[] = [];

  for (const deposit of unsweptDeposits) {
    const depositAddress = deposit.address || deposit.to_address;
    if (!depositAddress) continue;

    // Get derivation index for address
    let derivationIndex: number | null = null;
    const { data: addrRecord } = await supabaseAdmin
      .from('user_deposit_addresses')
      .select('derivation_index')
      .eq('address', depositAddress)
      .eq('network', deposit.network)
      .maybeSingle();

    if (addrRecord && typeof addrRecord.derivation_index === 'number') {
      derivationIndex = addrRecord.derivation_index;
    } else {
      // Case-insensitive lookup
      const { data: ciRecord } = await supabaseAdmin
        .from('user_deposit_addresses')
        .select('derivation_index')
        .ilike('address', depositAddress)
        .maybeSingle();

      if (ciRecord && typeof ciRecord.derivation_index === 'number') {
        derivationIndex = ciRecord.derivation_index;
      }
    }

    if (derivationIndex === null) {
      continue;
    }

    const result = await sweepUserDepositAddress(
      depositAddress,
      deposit.network as any,
      derivationIndex
    );

    if (result.status === 'SUCCESS') {
      // Mark deposit as swept in database
      await supabaseAdmin
        .from('onchain_deposits')
        .update({
          is_swept: true,
          swept_tx_hash: result.txHash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', deposit.id);
    }

    results.push(result);
  }

  return results;
}

export const runDepositSweeper = runAutomatedSweeperJob;
