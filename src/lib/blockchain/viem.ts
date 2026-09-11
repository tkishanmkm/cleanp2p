import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.ETH_SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/alch_60h82hz17l-PYtgn20DyU'),
});

export const sepoliaClient = publicClient;
