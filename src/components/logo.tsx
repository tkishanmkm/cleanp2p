'use client';
import { APP_NAME } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useBranding } from '@/context/branding-context';
import Image from 'next/image';
import { useIsMobile } from '@/hooks/use-mobile';

export function Logo({ className }: { className?: string }) {
  const { branding } = useBranding();
  const isMobile = useIsMobile();

  if (isMobile && branding?.appLogoMobile) {
    return <Image src={branding.appLogoMobile} alt={APP_NAME} width={30} height={30} className={cn("object-contain h-[30px] w-auto", className)} />;
  }

  if (branding?.appLogo) {
    return <Image src={branding.appLogo} alt={APP_NAME} width={120} height={30} className={cn("object-contain h-[30px] w-auto", className)} />;
  }
  
  return (
    <div className={cn("text-2xl font-bold text-primary", className)}>
      {APP_NAME}
    </div>
  );
}
