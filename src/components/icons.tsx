import React from 'react';
import Image from 'next/image';

export function PaxonesLogo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#0052FF"/>
      <path d="M10 8H18C21.3137 8 24 10.6863 24 14C24 17.3137 21.3137 20 18 20H14V24H10V8ZM14 12V16H18C19.1046 16 20 15.1046 20 14C20 12.8954 19.1046 12 18 12H14Z" fill="white"/>
    </svg>
  );
}

export function BtcLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/crypto/btc.webp"
      alt="BTC"
      width={32}
      height={32}
      className={`object-contain inline-block rounded-full ${className}`}
    />
  );
}

export function EthLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/crypto/eth.webp"
      alt="ETH"
      width={32}
      height={32}
      className={`object-contain inline-block rounded-full ${className}`}
    />
  );
}

export function LtcLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/crypto/ltc.webp"
      alt="LTC"
      width={32}
      height={32}
      className={`object-contain inline-block rounded-full ${className}`}
    />
  );
}

export function UsdtLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <Image
      src="/crypto/usdt.webp"
      alt="USDT"
      width={32}
      height={32}
      className={`object-contain inline-block rounded-full ${className}`}
    />
  );
}

export function DefaultAvatar({ className = "h-8 w-8", ...props }: React.ComponentProps<'svg'>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="12" cy="12" r="12" className="text-muted-foreground/30 fill-current" />
      <path
        d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"
        className="text-muted-foreground fill-current"
      />
    </svg>
  );
}

