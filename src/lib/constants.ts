import type { CryptoCurrency, SupportedCrypto, Language } from './types';

export const APP_NAME = 'Paxones';

export const SUPPORTED_CRYPTOS: SupportedCrypto[] = [
  { name: 'USDT', chains: ["ERC20", "TRC20", "BEP20"] },
  { name: 'BTC', chains: ["BTC"] },
  { name: 'ETH', chains: ["ETH"] },
  { name: 'LTC', chains: ["LTC"] },
];

export const CHAINS: Record<CryptoCurrency, string[]> = {
  BTC: ['BTC'],
  ETH: ['ETH'],
  LTC: ['LTC'],
  USDT: ['ERC20', 'TRC20', 'BEP20'],
  BNB: [], // Kept for type consistency, but no longer a primary asset
  MATIC: [], // Kept for type consistency, but no longer a primary asset
  TRX: [], // Kept for type consistency, but no longer a primary asset
};

export const FIXED_WITHDRAWAL_FEES_USD: { [key: string]: number } = {
  'BTC': 4,
  'LTC': 4,
  'ETH': 4,
  'USDT-ERC20': 4,
  'USDT-TRC20': 2,
  'USDT-BEP20': 2,
};


export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh-CN', name: 'Simplified Chinese', nativeName: '简体中文' },
  { code: 'zh-TW', name: 'Traditional Chinese', nativeName: '繁體中文' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', nativeName: 'Português brasileiro' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    dialects: [
        { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
        { code: 'en-IN', name: 'Hinglish', nativeName: 'Hinglish' },
        { code: 'bho', name: 'Bhojpuri', nativeName: 'भोजपुरी' },
    ]
  },
];

// In a real app, these would be in environment variables
export const ADMIN_ID = 'Narayanharihari';
export const ADMIN_PASS = 'XGY6ukm@5498';

export const SECURITY_QUESTIONS = [
    "What was your first pet's name?",
    "What is your mother's maiden name?",
    "What was the name of your elementary school?",
    "In what city were you born?",
    "What is your favorite book?",
];

export const BLOCK_LIMIT = 10000;

export const AD_TAGS = [
  "No third party",
  "No receipt required",
  "No verification",
  "Invoice accepted",
];

export interface TokenConfig {
  contractAddress: string;
  decimals: number;
}

export const USDT_CONFIGS: Record<string, TokenConfig> = {
  TRC20: {
    contractAddress: process.env.USDT_CONTRACT_TRC20 || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
  },
  ERC20: {
    contractAddress: process.env.USDT_CONTRACT_ERC20 || '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
  },
  BEP20: {
    contractAddress: process.env.USDT_CONTRACT_BEP20 || '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
  },
  POLYGON: {
    contractAddress: process.env.USDT_CONTRACT_POLYGON || '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    decimals: 6,
  },
};

export function getUsdtConfig(network: string): TokenConfig {
  const norm = network.toUpperCase().trim();
  const aliasMap: Record<string, string> = {
    ETH: 'ERC20',
    ETHEREUM: 'ERC20',
    BSC: 'BEP20',
    BINANCE: 'BEP20',
    TRON: 'TRC20',
    MATIC: 'POLYGON',
  };
  const resolvedKey = aliasMap[norm] || norm;
  const config = USDT_CONFIGS[resolvedKey];
  if (!config) {
    throw new Error(`Unsupported network for USDT: ${network}`);
  }
  return config;
}

