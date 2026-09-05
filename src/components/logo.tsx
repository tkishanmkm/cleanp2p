'use client';

import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';
import { useState } from 'react';

export interface LogoProps {
  className?: string;
  imgClassName?: string;
  variant?: 'auto' | 'desktop' | 'mobile';
  priority?: boolean;
}

export function Logo({
  className,
  imgClassName,
  variant = 'auto',
  priority = true,
}: LogoProps) {
  const { branding } = useBranding();
  const [mobileError, setMobileError] = useState(false);
  const [desktopError, setDesktopError] = useState(false);

  const mobileLogoSrc = branding?.appLogoMobile?.trim() || '/logo-mobile.webp';
  const desktopLogoSrc = (branding?.appLogoDesktop?.trim() || branding?.appLogo?.trim()) || '/logo-desktop.webp';
  const appName = branding?.appName || APP_NAME;

  // Fallback vector brand element
  const renderFallback = (isDesktop: boolean) => (
    <div className="flex items-center gap-2.5 font-bold tracking-tight select-none">
      <div className="relative flex items-center justify-center shrink-0">
        <svg
          width="34"
          height="34"
          viewBox="0 0 36 36"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 sm:h-9 sm:w-9 drop-shadow-sm"
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
          </defs>
          <rect x="2" y="2" width="32" height="32" rx="10" fill="url(#paxonesGrad)" />
          <path d="M12 15L18 9L24 15M18 10V21" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M24 21L18 27L12 21M18 26V15" stroke="url(#paxonesAccent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="18" cy="18" r="2.2" fill="white" />
        </svg>
      </div>
      {isDesktop && (
        <div className="flex items-center gap-1.5">
          <span className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-gray-900 via-gray-800 to-gray-950 dark:from-white dark:via-gray-100 dark:to-gray-300 bg-clip-text text-transparent">
            {appName}
          </span>
          <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/25 dark:text-indigo-300 border border-indigo-500/20">
            P2P
          </span>
        </div>
      )}
    </div>
  );

  // Forced Mobile Variant
  if (variant === 'mobile') {
    return (
      <div className={cn("flex items-center shrink-0", className)}>
        {!mobileError ? (
          <div className="relative h-9 w-9 flex items-center justify-center">
            <Image
              src={mobileLogoSrc}
              alt={appName}
              fill
              sizes="36px"
              priority={priority}
              referrerPolicy="no-referrer"
              className={cn("object-contain", imgClassName)}
              onError={() => setMobileError(true)}
            />
          </div>
        ) : (
          renderFallback(false)
        )}
      </div>
    );
  }

  // Forced Desktop Variant
  if (variant === 'desktop') {
    return (
      <div className={cn("flex items-center shrink-0", className)}>
        {!desktopError ? (
          <div className="relative h-9 sm:h-10 w-36 sm:w-44 flex items-center justify-start">
            <Image
              src={desktopLogoSrc}
              alt={appName}
              fill
              sizes="176px"
              priority={priority}
              referrerPolicy="no-referrer"
              className={cn("object-contain object-left", imgClassName)}
              onError={() => setDesktopError(true)}
            />
          </div>
        ) : (
          renderFallback(true)
        )}
      </div>
    );
  }

  // Responsive Variant (default 'auto'):
  // Mobile screens (< 768px): Shows logo-mobile.webp
  // Desktop screens (>= 768px): Shows logo-desktop.webp
  return (
    <div className={cn("flex items-center shrink-0 select-none", className)}>
      {/* Mobile Logo (< md) */}
      <div className="relative h-9 w-9 md:hidden flex items-center justify-center">
        {!mobileError ? (
          <Image
            src={mobileLogoSrc}
            alt={appName}
            fill
            sizes="36px"
            priority={priority}
            referrerPolicy="no-referrer"
            className={cn("object-contain", imgClassName)}
            onError={() => setMobileError(true)}
          />
        ) : (
          renderFallback(false)
        )}
      </div>

      {/* Desktop Logo (>= md) */}
      <div className="relative hidden h-9 sm:h-10 w-36 sm:w-44 md:flex items-center justify-start">
        {!desktopError ? (
          <Image
            src={desktopLogoSrc}
            alt={appName}
            fill
            sizes="176px"
            priority={priority}
            referrerPolicy="no-referrer"
            className={cn("object-contain object-left", imgClassName)}
            onError={() => setDesktopError(true)}
          />
        ) : (
          renderFallback(true)
        )}
      </div>
    </div>
  );
}
