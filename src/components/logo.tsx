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
    <div className={cn("flex items-center gap-2 font-bold text-primary", className)}>
      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
        <ShieldAlert className="w-5 h-5 text-white" />
      </div>
      <span className="text-xl tracking-tight font-bold">{branding?.appName || APP_NAME}</span>
    </div>
  );
}
