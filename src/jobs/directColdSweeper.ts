import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '../lib/supabase/server';

// ERC-20 Minimal ABI for balance checking and transfers
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export async function runDirectColdSweep(assetSymbol: string) {
  const supabase = getSupabaseAdminClient();

  // 1. Fetch sweep configuration from DB
  const { data: config, error } = await supabase
    .from('cold_storage_config')
    .select('*')
    .eq('asset_symbol', assetSymbol)
    .eq('is_active', true)
    .single();

  if (error || !config) {
    console.log(`[Sweeper] No active cold storage configuration found for ${assetSymbol}.`);
    return;
  }

  const rpcUrl = process.env.EVM_RPC_URL;
  const hotWalletPrivKey = process.env.EVM_HOT_WALLET_PRIVATE_KEY;
  const tokenContractAddress = process.env.USDT_CONTRACT_ADDRESS;

  if (!rpcUrl || !hotWalletPrivKey || !tokenContractAddress) {
    throw new Error('[Sweeper] Missing EVM RPC or Wallet environment variables.');
  }

  // 2. Initialize provider and hot wallet signer
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const formattedPrivateKey = hotWalletPrivKey.startsWith('0x')
    ? hotWalletPrivKey
    : `0x${hotWalletPrivKey}`;
  const hotWallet = new ethers.Wallet(formattedPrivateKey, provider);
  const tokenContract = new ethers.Contract(tokenContractAddress, ERC20_ABI, hotWallet);

  // 3. Query live balance on-chain
  const decimals: number = Number(await tokenContract.decimals());
  const rawBalance: bigint = await tokenContract.balanceOf(hotWallet.address);
  const currentBalance = parseFloat(ethers.formatUnits(rawBalance, decimals));

  console.log(`[Sweeper] Current ${assetSymbol} Hot Wallet Balance: ${currentBalance}`);

  const maxCap = parseFloat(config.max_hot_wallet_cap);
  const targetReserve = parseFloat(config.target_reserve_units);

  // 4. Check if hot wallet balance exceeds safety cap
  if (currentBalance > maxCap) {
    const sweepAmountUnits = currentBalance - targetReserve;
    console.log(`🚨 Balance exceeds cap (${maxCap}). Sweeping ${sweepAmountUnits} ${assetSymbol} to cold storage...`);

    const sweepAmountWei = ethers.parseUnits(sweepAmountUnits.toFixed(decimals), decimals);

    // 5. Broadcast direct transfer to single-owner cold address
    const tx = await tokenContract.transfer(config.cold_wallet_address, sweepAmountWei);
    console.log(`[Sweeper] Transaction broadcasted. Tx Hash: ${tx.hash}`);

    await tx.wait(1); // Wait for 1 confirmation
    console.log(`✅ Sweep confirmed on-chain.`);

    // 6. Record sweep audit entry in Supabase
    await supabase.from('cold_storage_sweeps').insert({
      asset_symbol: assetSymbol,
      amount_swept: sweepAmountUnits,
      from_address: hotWallet.address,
      to_cold_address: config.cold_wallet_address,
      tx_hash: tx.hash,
    });
  } else {
    console.log(`[Sweeper] Balance is within safe operating limits (${currentBalance} <= ${maxCap}). No sweep needed.`);
  }
}
