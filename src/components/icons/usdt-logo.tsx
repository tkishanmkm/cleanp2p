'use client';
import { cn } from "@/lib/utils";
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';

export function UsdtLogo({ className }: { className?: string }) {
  const { branding } = useBranding();

  if (branding?.usdtLogo) {
    return <Image src={branding.usdtLogo} alt="USDT Logo" width={32} height={32} className={cn("h-8 w-8", className)} />;
  }

  return (
    <svg
      className={cn("h-8 w-8", className)}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M24,47A23,23,0,1,1,47,24,23,23,0,0,1,24,47Z" fill="#50af95"></path>
      <path d="M28.4,16.4H19.6a1,1,0,0,0-1,1V20a1,1,0,0,0,1,1h2.5v9.5a1.8,1.8,0,0,0,1.8,1.8h.2a1.8,1.8,0,0,0,1.8-1.8V21h2.5a1,1,0,0,0,1-1V17.4A1,1,0,0,0,28.4,16.4Z" fill="#fff"></path>
    </svg>
  );
}