import { ethers } from 'ethers';

const ERC20_TRANSFER_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
];

// Sequential lock to protect against nonce race conditions during concurrent execution
let withdrawalLock: Promise<any> = Promise.resolve();

export async function executeHotWalletWithdrawal(
  toAddress: string,
  amountUnits: string,
  tokenContractAddress: string
): Promise<string> {
  // 1. Checksum address validation to protect against malformed inputs
  let validRecipient: string;
  try {
    validRecipient = ethers.getAddress(toAddress);
  } catch {
    throw new Error(`Invalid recipient EVM address: ${toAddress}`);
  }

  const rpcUrl = process.env.EVM_RPC_URL;
  const privateKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error('EVM RPC URL or Hot Wallet Private Key is not configured.');
  }

  // 2. Queue sequentially to ensure atomic nonce assignment and prevent collisions
  return new Promise<string>((resolve, reject) => {
    withdrawalLock = withdrawalLock
      .then(async () => {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const formattedPrivateKey = privateKey.startsWith('0x')
          ? privateKey
          : `0x${privateKey}`;
        const wallet = new ethers.Wallet(formattedPrivateKey, provider);
        const contract = new ethers.Contract(tokenContractAddress, ERC20_TRANSFER_ABI, wallet);

        // Standard 6 decimals for USDT
        const amountWei = ethers.parseUnits(amountUnits, 6);

        console.log(`[Hot Wallet] Estimating gas and nonce for withdrawal of ${amountUnits} USDT to ${validRecipient}...`);

        // 3. Dynamic Gas Limit Estimation with 20% safety buffer
        let gasLimit: bigint;
        try {
          const estimatedGas = await contract.transfer.estimateGas(validRecipient, amountWei);
          gasLimit = (estimatedGas * 120n) / 100n; // 20% buffer
        } catch (gasErr: any) {
          console.warn('[Hot Wallet] Gas estimation fallback:', gasErr?.message);
          gasLimit = 100000n; // Safe fallback limit for standard ERC-20 transfer
        }

        // 4. Nonce protection: fetch current pending transaction count
        const nonce = await provider.getTransactionCount(wallet.address, 'pending');

        console.log(`[Hot Wallet] Broadcasting transfer with nonce ${nonce} and gasLimit ${gasLimit}...`);

        const tx = await contract.transfer(validRecipient, amountWei, {
          gasLimit,
          nonce,
        });

        console.log(`[Hot Wallet] Transaction submitted: ${tx.hash}. Waiting for 1 confirmation...`);
        await tx.wait(1);

        console.log(`[Hot Wallet] Withdrawal Successful. Tx Hash: ${tx.hash}`);
        resolve(tx.hash);
      })
      .catch((err) => {
        console.error('[Hot Wallet] Withdrawal execution error:', err);
        reject(err);
      });
  });
}
