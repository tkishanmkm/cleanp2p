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

  const hasMobileLogo = Boolean(branding?.appLogoMobile && branding.appLogoMobile !== '/logo.png');
  const hasDesktopLogo = Boolean(branding?.appLogo && branding.appLogo !== '/logo.png');

  if (isMobile && hasMobileLogo && branding?.appLogoMobile) {
    return (
      <Image
        src={branding.appLogoMobile}
        alt={APP_NAME}
        width={30}
        height={30}
        className={cn("object-contain h-[30px] w-auto", className)}
      />
    );
  }

  if (hasDesktopLogo && branding?.appLogo) {
    return (
      <Image
        src={branding.appLogo}
        alt={APP_NAME}
        width={120}
        height={30}
        className={cn("object-contain h-[30px] w-auto", className)}
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
