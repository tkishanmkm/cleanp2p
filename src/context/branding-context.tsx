'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';

export interface BrandingConfig {
  appLogo?: string;
  appLogoDesktop?: string;
  appLogoMobile?: string;
  appName?: string;
  primaryColor?: string;
  accentColor?: string;
  btcLogo?: string;
  ethLogo?: string;
  ltcLogo?: string;
  usdtLogo?: string;
}

interface BrandingContextType {
  branding: BrandingConfig;
  isLoading: boolean;
  setBrandingConfig: (config: Partial<BrandingConfig>) => void;
}

const BRANDING_CACHE_KEY = 'app_branding_config';
const BRANDING_VERSION_KEY = 'wayones_branding_version';
const BRANDING_VERSION = '1';

const defaultBranding: BrandingConfig = {
  appName: 'Wayones',
  appLogo: '/logo-desktop.webp',
  appLogoDesktop: '/logo-desktop.webp',
  appLogoMobile: '/logo-mobile.webp',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readCachedBranding(): BrandingConfig {
  try {
    const cached = localStorage.getItem(BRANDING_CACHE_KEY);
    const parsed: unknown = cached ? JSON.parse(cached) : {};
    if (!isRecord(parsed)) return defaultBranding;

    if (localStorage.getItem(BRANDING_VERSION_KEY) !== BRANDING_VERSION) {
      // One-time migration: discard stale app name and old app-logo overrides,
      // but preserve crypto icons and appearance colors selected by the user.
      const migrated: BrandingConfig = {
        ...defaultBranding,
        ...(typeof parsed.primaryColor === 'string' ? { primaryColor: parsed.primaryColor } : {}),
        ...(typeof parsed.accentColor === 'string' ? { accentColor: parsed.accentColor } : {}),
        ...(typeof parsed.btcLogo === 'string' ? { btcLogo: parsed.btcLogo } : {}),
        ...(typeof parsed.ethLogo === 'string' ? { ethLogo: parsed.ethLogo } : {}),
        ...(typeof parsed.ltcLogo === 'string' ? { ltcLogo: parsed.ltcLogo } : {}),
        ...(typeof parsed.usdtLogo === 'string' ? { usdtLogo: parsed.usdtLogo } : {}),
      };
      localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(migrated));
      localStorage.setItem(BRANDING_VERSION_KEY, BRANDING_VERSION);
      return migrated;
    }

    return {
      ...defaultBranding,
      ...parsed,
      appName: 'Wayones',
    } as BrandingConfig;
  } catch {
    return defaultBranding;
  }
}

const BrandingContext = createContext<BrandingContextType>({
  branding: defaultBranding,
  isLoading: true,
  setBrandingConfig: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      setBranding(readCachedBranding());
    } catch {
      setBranding(defaultBranding);
    }

    async function fetchBranding() {
      try {
        const response = await fetch('/api/admin/branding', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Branding request failed (${response.status})`);
        const result = await response.json();
        if (result?.success && isRecord(result.branding)) {
          setBranding((prev) => ({
            ...prev,
            ...result.branding,
            appName: 'Wayones',
          }));
        }
      } catch (err) {
        console.warn('Notice loading branding config from server:', err);
      } finally {
        setIsLoading(false);
      }
    }

    void fetchBranding();

    const handleCustomBranding = (event: Event) => {
      const config = (event as CustomEvent<Partial<BrandingConfig>>).detail;
      if (isRecord(config)) {
        setBranding((prev) => ({ ...prev, ...config, appName: 'Wayones' }));
      }
    };
    window.addEventListener('branding_updated', handleCustomBranding);

    return () => {
      window.removeEventListener('branding_updated', handleCustomBranding);
    };
  }, []);

  const setBrandingConfig = (config: Partial<BrandingConfig>) => {
    setBranding((prev) => {
      const updated: BrandingConfig = { ...prev, ...config, appName: 'Wayones' };
      try {
        localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(updated));
        localStorage.setItem(BRANDING_VERSION_KEY, BRANDING_VERSION);
      } catch {
        // Brand defaults remain available from the bundled application assets.
      }
      return updated;
    });
  };

  return (
    <BrandingContext.Provider value={{ branding, isLoading, setBrandingConfig }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
