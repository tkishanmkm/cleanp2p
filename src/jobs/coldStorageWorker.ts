import { createPublicClient, createWalletClient, http, formatUnits, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: true,
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', type: 'uint8' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
] as const;

export interface ColdStorageResult {
  success: boolean;
  network: string;
  hotWalletAddress?: string;
  currentBalance?: string;
  offloadedAmount?: string;
  txHash?: string;
  message: string;
}

/**
 * Checks the hot wallet ERC-20 token balance (e.g. USDT) against maximum safety threshold.
 * If balance exceeds maxCap, transfers the excess balance down to reserveThreshold into cold storage.
 */
export async function checkAndOffloadToColdStorage(
  networkName: string,
  rpcUrl: string,
  hotWalletPrivateKey: string,
  tokenContractAddress: string,
  maxCap: string,
  reserveThreshold: string
): Promise<ColdStorageResult> {
  try {
    const formattedPrivateKey = (hotWalletPrivateKey.startsWith('0x')
      ? hotWalletPrivateKey
      : `0x${hotWalletPrivateKey}`) as `0x${string}`;

    const account = privateKeyToAccount(formattedPrivateKey);
    const hotWalletAddress = account.address;

    const publicClient = createPublicClient({
      chain: networkName.toLowerCase().includes('sepolia') ? sepolia : mainnet,
      transport: http(rpcUrl),
    });

    // 1. Fetch token decimals (default 6 for USDT if query fails)
    let decimals = 6;
    try {
      const queriedDecimals = await publicClient.readContract({
        address: tokenContractAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'decimals',
      });
      decimals = Number(queriedDecimals) || 6;
    } catch {
      decimals = 6; // USDT standard on Ethereum/Tron
    }

    // 2. Fetch current Hot Wallet token balance
    const rawBalance = (await publicClient.readContract({
      address: tokenContractAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [hotWalletAddress],
    })) as bigint;

    const currentBalanceFormatted = formatUnits(rawBalance, decimals);
    const currentBalanceNum = parseFloat(currentBalanceFormatted);
    const maxCapNum = parseFloat(maxCap);
    const reserveThresholdNum = parseFloat(reserveThreshold);

    console.log(
      `[Cold Storage Worker] [${networkName}] Hot Wallet: ${hotWalletAddress} | Current Balance: ${currentBalanceFormatted} USDT | Cap: ${maxCap} USDT | Reserve: ${reserveThreshold} USDT`
    );

    // 3. Check if balance exceeds maximum cap
    if (currentBalanceNum <= maxCapNum) {
      return {
        success: true,
        network: networkName,
        hotWalletAddress,
        currentBalance: currentBalanceFormatted,
        message: `Balance (${currentBalanceFormatted}) within safe cap (${maxCap}). No offload needed.`,
      };
    }

    // 4. Calculate excess to offload to cold storage
    const offloadAmountNum = Math.max(0, currentBalanceNum - reserveThresholdNum);
    if (offloadAmountNum <= 0) {
      return {
        success: true,
        network: networkName,
        hotWalletAddress,
        currentBalance: currentBalanceFormatted,
        message: `No excess funds available above reserve threshold (${reserveThreshold}).`,
      };
    }

    const coldStorageAddress =
      process.env.COLD_STORAGE_ADDRESS ||
      process.env.EVM_COLD_STORAGE_ADDRESS;

    if (!coldStorageAddress) {
      console.warn(
        `⚠️ [Cold Storage Worker] ALERT: Hot wallet balance (${currentBalanceFormatted}) exceeds cap (${maxCap}), but COLD_STORAGE_ADDRESS is not configured!`
      );
      return {
        success: false,
        network: networkName,
        hotWalletAddress,
        currentBalance: currentBalanceFormatted,
        offloadedAmount: offloadAmountNum.toString(),
        message: 'Cold storage address not configured in environment (COLD_STORAGE_ADDRESS).',
      };
    }

    // 5. Execute transfer to cold storage
    const walletClient = createWalletClient({
      account,
      chain: networkName.toLowerCase().includes('sepolia') ? sepolia : mainnet,
      transport: http(rpcUrl),
    });

    const rawOffloadAmount = parseUnits(offloadAmountNum.toFixed(decimals), decimals);

    const txHash = await walletClient.writeContract({
      address: tokenContractAddress as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [coldStorageAddress as `0x${string}`, rawOffloadAmount],
    });

    console.log(
      `🔒 [Cold Storage Worker] SUCCESS: Offloaded ${offloadAmountNum} USDT to Cold Storage (${coldStorageAddress}). Tx: ${txHash}`
    );

    return {
      success: true,
      network: networkName,
      hotWalletAddress,
      currentBalance: currentBalanceFormatted,
      offloadedAmount: offloadAmountNum.toString(),
      txHash,
      message: `Successfully swept ${offloadAmountNum} USDT to cold storage ${coldStorageAddress}.`,
    };
  } catch (error: any) {
    console.error(`❌ [Cold Storage Worker] Error executing offload:`, error?.message || error);
    return {
      success: false,
      network: networkName,
      message: error?.message || 'Unknown error occurred in cold storage worker',
    };
  }
}
