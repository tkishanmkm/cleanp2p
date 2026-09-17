'use client';

import { useState, useEffect } from 'react';
import { getUserTimezonePreference, parseUtcOffsetMinutes, getFriendlyTzTag } from '@/lib/date-utils';

export function useUserTimezone() {
  const [timezone, setTimezone] = useState<string>('UTC±00:00');

  useEffect(() => {
    // Initial fetch
    const current = getUserTimezonePreference();
    setTimezone(current);

    const handleTzChange = (e: any) => {
      const newTz = e?.detail || getUserTimezonePreference();
      setTimezone(newTz);
    };

    window.addEventListener('paxones:timezone-changed', handleTzChange);
    window.addEventListener('timezone-changed', handleTzChange);
    window.addEventListener('storage', handleTzChange);

    return () => {
      window.removeEventListener('paxones:timezone-changed', handleTzChange);
      window.removeEventListener('timezone-changed', handleTzChange);
      window.removeEventListener('storage', handleTzChange);
    };
  }, []);

  return {
    timezone,
    offsetMinutes: parseUtcOffsetMinutes(timezone),
    friendlyTag: getFriendlyTzTag(timezone),
  };
}
