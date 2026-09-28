import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

export const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || process.env.EVM_RPC_URL || 'https://cloudflare-eth.com'),
});

export const ethMainnetClient = publicClient;
export const sepoliaClient = publicClient; // backwards-compatible alias pointing to mainnet client
