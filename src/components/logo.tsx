'use client';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';
import { useIsMobile } from '@/hooks/use-mobile';
import { ShieldAlert } from 'lucide-react';

export function Logo({ className }: { className?: string }) {
  const { branding } = useBranding();
  const isMobile = useIsMobile();

  const mobileLogoSrc = branding?.appLogoMobile;
  const desktopLogoSrc = branding?.appLogoDesktop || branding?.appLogo;

  const hasMobileLogo = Boolean(mobileLogoSrc && mobileLogoSrc !== '/logo.png');
  const hasDesktopLogo = Boolean(desktopLogoSrc && desktopLogoSrc !== '/logo.png');

  if (isMobile && hasMobileLogo && mobileLogoSrc) {
    return (
      <Image
        src={mobileLogoSrc}
        alt={APP_NAME}
        width={36}
        height={36}
        className={cn("object-contain h-[32px] w-auto", className)}
        unoptimized
      />
    );
  }

  if (hasDesktopLogo && desktopLogoSrc) {
    return (
      <Image
        src={desktopLogoSrc}
        alt={APP_NAME}
        width={130}
        height={36}
        className={cn("object-contain h-[32px] w-auto", className)}
        unoptimized
      />
    );
  }
  
  return (
    <div className={cn("flex items-center gap-2.5 font-bold tracking-tight select-none", className)}>
      {/* Custom Vector Brand Mark */}
      <div className="relative flex items-center justify-center shrink-0">
        <svg
          width="36"
          height="36"
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-9 w-9 drop-shadow-sm transition-transform duration-200 hover:scale-105"
        >
          <defs>
            <linearGradient id="paxonesGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#5B4DF6" />
              <stop offset="50%" stopColor="#6366F1" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
            <linearGradient id="paxonesAccent" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38BDF8" />
              <stop offset="100%" stopColor="#818CF8" />
            </linearGradient>
            <filter id="paxonesGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#5B4DF6" floodOpacity="0.3" />
            </filter>
          </defs>
          {/* Rounded Hexagonal Base with subtle stroke */}
          <rect
            x="2"
            y="2"
            width="32"
            height="32"
            rx="10"
            fill="url(#paxonesGrad)"
            filter="url(#paxonesGlow)"
          />
          {/* Dynamic Interlocking P2P Exchange Paths */}
          <path
            d="M12 15L18 9L24 15M18 10V21"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M24 21L18 27L12 21M18 26V15"
            stroke="url(#paxonesAccent)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Central Security Core Dot */}
          <circle cx="18" cy="18" r="2.2" fill="white" />
        </svg>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-950 dark:from-white dark:via-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
          {branding?.appName || APP_NAME}
        </span>
        <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-[#5B4DF6]/10 text-[#5B4DF6] dark:bg-[#5B4DF6]/25 dark:text-indigo-300 border border-[#5B4DF6]/20">
          P2P
        </span>
      </div>
    </div>
  );
}
