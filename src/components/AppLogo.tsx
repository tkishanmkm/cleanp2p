import { Logo } from '@/components/logo';
import Link from 'next/link';

export interface AppLogoProps {
  href?: string;
  className?: string;
  variant?: 'auto' | 'desktop' | 'mobile';
  priority?: boolean;
}

export default function AppLogo({
  href = '/',
  className,
  variant = 'auto',
  priority = true,
}: AppLogoProps) {
  return (
    <Link href={href} className="flex items-center">
      <Logo className={className} variant={variant} priority={priority} />
    </Link>
  );
}
export { AppLogo };

