import { ethers } from 'ethers';
import { getSupabaseAdminClient } from '../lib/supabase/server';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export async function checkHotWalletBalance(assetSymbol: string) {
  const supabase = getSupabaseAdminClient();

  // 1. Fetch asset configuration from DB
  const { data: config, error } = await supabase
    .from('hot_wallet_config')
    .select('*')
    .eq('asset_symbol', assetSymbol)
    .eq('is_active', true)
    .single();

  if (error || !config) {
    console.log(`[Hot Wallet Monitor] No active config found for ${assetSymbol}.`);
    return;
  }

  const rpcUrl = process.env.EVM_RPC_URL;
  const hotWalletAddress = process.env.EVM_HOT_WALLET_ADDRESS;
  const tokenContractAddress = process.env.USDT_CONTRACT_ADDRESS;

  if (!rpcUrl || !hotWalletAddress || !tokenContractAddress) {
    throw new Error('[Hot Wallet Monitor] Missing EVM RPC or Wallet environment variables.');
  }

  // 2. Query live ERC-20 token balance on-chain
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const tokenContract = new ethers.Contract(tokenContractAddress, ERC20_ABI, provider);

  const decimals: number = Number(await tokenContract.decimals());
  const rawBalance: bigint = await tokenContract.balanceOf(hotWalletAddress);
  const currentBalance = parseFloat(ethers.formatUnits(rawBalance, decimals));

  // 3. Query native gas token balance (ETH)
  const rawNativeBalance = await provider.getBalance(hotWalletAddress);
  const nativeBalance = parseFloat(ethers.formatEther(rawNativeBalance));

  console.log(`[Hot Wallet Monitor] Asset: ${assetSymbol} | Token Balance: ${currentBalance} | Gas (ETH): ${nativeBalance}`);

  // 4. Alert if hot wallet requires manual top-up or native gas is low
  if (currentBalance < parseFloat(config.min_refill_threshold)) {
    console.warn(`⚠️ LOW LIQUIDITY ALERT: ${assetSymbol} balance (${currentBalance}) is below threshold (${config.min_refill_threshold}).`);
  }

  if (nativeBalance < 0.01) {
    console.warn(`🚨 LOW GAS ALERT: Hot wallet ETH balance (${nativeBalance} ETH) is low. Outbound transfers may fail.`);
  }
}
