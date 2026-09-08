'use client';
import { cn } from "@/lib/utils";
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';

export function BtcLogo({ className }: { className?: string }) {
  const { branding } = useBranding();
  const logoSrc = branding?.btcLogo || '/crypto/btc.webp';

  return (
    <Image
      src={logoSrc}
      alt="BTC"
      width={48}
      height={48}
      className={cn("h-8 w-8 object-contain inline-block rounded-full", className)}
    />
  );
}
