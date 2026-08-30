'use client';
import { cn } from "@/lib/utils";
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';

export function BtcLogo({ className }: { className?: string }) {
  const { branding } = useBranding();

  if (branding?.btcLogo) {
    return <Image src={branding.btcLogo} alt="BTC Logo" width={32} height={32} className={cn("h-8 w-8", className)} />;
  }
  
  return (
    <svg
      className={cn("h-8 w-8", className)}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M24,47A23,23,0,1,1,47,24,23,23,0,0,1,24,47Z" fill="#f7931a"></path>
      <path
        d="M32.5,27.8A7.2,7.2,0,0,0,34,24.1a7.6,7.6,0,0,0-7.7-7.6H20.7V34h6.3a7.7,7.7,0,0,0,7.6-7.7,6.3,6.3,0,0,0-1.1-3.5m-5.8,3.2H23.7V28.3h3a1.2,1.2,0,1,1,0,2.4m1.1-5.3H23.7V20.1h4.1a1.2,1.2,0,1,1,0,2.4"
        fill="#fff"
      ></path>
    </svg>
  );
}