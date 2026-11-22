import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';

export function CoinBadgeLogo({ coin, className = 'h-5 w-5' }: { coin: string; className?: string }) {
  const norm = (coin || '').toUpperCase();
  switch (norm) {
    case 'BTC':
    case 'BITCOIN':
      return <BtcLogo className={className} />;
    case 'ETH':
    case 'ETHEREUM':
      return <EthLogo className={className} />;
    case 'LTC':
    case 'LITECOIN':
      return <LtcLogo className={className} />;
    case 'USDT':
    case 'USDT-ERC20':
    case 'USDT-TRC20':
    case 'USDT-BEP20':
      return <UsdtLogo className={className} />;
    default:
      return <UsdtLogo className={className} />;
  }
}
