'use client';
import { cn } from "@/lib/utils";
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';

export function EthLogo({ className }: { className?: string }) {
  const { branding } = useBranding();

  if (branding?.ethLogo) {
    return <Image src={branding.ethLogo} alt="ETH Logo" width={32} height={32} className={cn("h-8 w-8", className)} />;
  }

  return (
    <svg
      className={cn("h-8 w-8", className)}
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path d="M24,47A23,23,0,1,1,47,24,23,23,0,0,1,24,47Z" fill="#627eea"></path>
      <path d="M24,18.9,16.4,24,24,28.5,31.6,24Z" fill="#fff"></path>
      <path
        d="m24,7.1-7.6,15.7,7.6,4.5,7.6-4.5Zm0,22.2L16.4,24l7.6-4.5,7.6,4.5Z"
        fill="#fff"
        opacity="0.6"
      ></path>
    </svg>
  );
}