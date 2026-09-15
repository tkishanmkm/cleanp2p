// Helper to safely access environment variables during static build time
const getEnv = (key: string, defaultValue: string = ''): string => {
  if (typeof window !== 'undefined') {
    // Prevent client-side exposure of server secrets
    if (!key.startsWith('NEXT_PUBLIC_')) {
      return defaultValue;
    }
  }
  return process.env[key] || defaultValue;
};

export const SYSTEM_CONFIG = {
  mnemonic: getEnv('DEPOSIT_HD_MNEMONIC'),
  hotWallets: {
    evm: {
      address: getEnv('EVM_HOT_WALLET_ADDRESS', getEnv('HOT_WALLET_PUBLIC_ADDRESS')),
      privateKey: getEnv('EVM_HOT_WALLET_PRIVATE_KEY', getEnv('HOT_WALLET_PRIVATE_KEY')),
    },
    tron: {
      address: getEnv('TRON_HOT_WALLET_ADDRESS'),
      privateKey: getEnv('TRON_HOT_WALLET_PRIVATE_KEY'),
    },
    btc: {
      address: getEnv('BTC_HOT_WALLET_ADDRESS'),
      privateKey: getEnv('BTC_HOT_WALLET_PRIVATE_KEY'),
    },
    ltc: {
      address: getEnv('LTC_HOT_WALLET_ADDRESS'),
      privateKey: getEnv('LTC_HOT_WALLET_PRIVATE_KEY'),
    },
  },
  contracts: {
    usdtErc20: getEnv('USDT_CONTRACT_ERC20', '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    usdtBep20: getEnv('USDT_CONTRACT_BEP20', '0x55d398326f99059fF775485246999027B3197955'),
    usdtTrc20: getEnv('USDT_CONTRACT_TRC20', 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'),
  },
  rpcs: {
    eth: getEnv('ETH_RPC_URL', getEnv('EVM_RPC_URL')),
    evm: getEnv('EVM_RPC_URL', getEnv('ETH_RPC_URL')),
    bsc: getEnv('BSC_RPC_URL', 'https://bsc-dataseed.binance.org/'),
    tron: getEnv('TRON_RPC_URL', 'https://api.trongrid.io'),
    btc: getEnv('BTC_RPC_URL'),
  },
  secrets: {
    depositWorker: getEnv('DEPOSIT_WORKER_SECRET'),
    withdrawalWorker: getEnv('WITHDRAWAL_WORKER_SECRET'),
    webhook: getEnv('BLOCKCHAIN_WEBHOOK_SECRET'),
    cron: getEnv('CRON_SECRET_KEY', getEnv('CRON_SECRET')),
  },
};
