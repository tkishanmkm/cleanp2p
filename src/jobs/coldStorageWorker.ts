import { ethers } from 'ethers';

const ERC20_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export async function checkAndOffloadToColdStorage(
  networkName: string,
  rpcUrl: string,
  hotWalletPrivateKey: string,
  tokenContractAddress: string,
  maxHotWalletCapUnits: string, // e.g. "50000" (50k USDT)
  targetReserveUnits: string     // e.g. "10000" (10k USDT)
) {
  try {
    const formattedKey = hotWalletPrivateKey.startsWith('0x') ? hotWalletPrivateKey : `0x${hotWalletPrivateKey}`;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const hotWallet = new ethers.Wallet(formattedKey, provider);
    const coldStorageAddress = process.env.COLD_STORAGE_MULTISIG_ADDRESS;

    if (!coldStorageAddress) {
      console.warn('[Cold Storage Offloader] COLD_STORAGE_MULTISIG_ADDRESS not set.');
      return;
    }

    const contract = new ethers.Contract(tokenContractAddress, ERC20_ABI, hotWallet);
    const decimals: number = await contract.decimals();

    const currentBalance: bigint = await contract.balanceOf(hotWallet.address);
    const capThreshold: bigint = ethers.parseUnits(maxHotWalletCapUnits, decimals);
    const targetReserve: bigint = ethers.parseUnits(targetReserveUnits, decimals);

    if (currentBalance > capThreshold) {
      const surplusAmount = currentBalance - targetReserve;
      console.log(
        `[Cold Storage] ${networkName} Hot Wallet balance (${ethers.formatUnits(currentBalance, decimals)}) exceeds cap (${maxHotWalletCapUnits}). Sweeping ${ethers.formatUnits(surplusAmount, decimals)} to Cold Storage (${coldStorageAddress})...`
      );

      const tx = await contract.transfer(coldStorageAddress, surplusAmount);
      console.log(`[Cold Storage] Offload transaction submitted: ${tx.hash}`);
      await tx.wait(2);
      console.log(`[Cold Storage] Offload confirmed for TX: ${tx.hash}`);
    }
  } catch (err: any) {
    console.error('[Cold Storage Offloader Error]', err.message);
  }
}
