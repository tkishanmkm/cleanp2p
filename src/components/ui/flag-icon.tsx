"use client";

import Image from 'next/image';
import { cn } from '@/lib/utils';

interface FlagIconProps {
  countryCode: string;
  className?: string;
}

export function FlagIcon({ countryCode, className }: FlagIconProps) {
  if (!countryCode) return null;
  return (
    <Image
      src={`https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`}
      width={20}
      height={15}
      alt={`${countryCode} flag`}
      className={cn('shrink-0 rounded-sm', className)}
    />
  );
}
