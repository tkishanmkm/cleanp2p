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

const defaultBranding: BrandingConfig = {
  appName: 'Paxones',
  appLogo: '/logo-desktop.webp',
  appLogoDesktop: '/logo-desktop.webp',
  appLogoMobile: '/logo-mobile.webp',
};

const BrandingContext = createContext<BrandingContextType>({
  branding: defaultBranding,
  isLoading: true,
  setBrandingConfig: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // 1. Initial check from localStorage for fast local persistence
    try {
      const cached = localStorage.getItem('app_branding_config');
      if (cached) {
        const parsed = JSON.parse(cached);
        setBranding((prev) => ({ ...prev, ...parsed }));
      }
    } catch (e) {
      console.warn('Could not read cached branding from localStorage');
    }

    // 2. Fetch the public branding payload through the server API.
    async function fetchBranding() {
      try {
        const response = await fetch('/api/admin/branding', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Branding request failed (${response.status})`);
        const result = await response.json();
        if (result?.success && result.branding && typeof result.branding === 'object') {
          setBranding((prev) => ({ ...prev, ...result.branding }));
        }
      } catch (err) {
        console.warn('Notice loading branding config from server:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBranding();

    // 3. Listen for window storage/custom events
    const handleCustomBranding = (e: any) => {
      if (e.detail) {
        setBranding((prev) => ({ ...prev, ...e.detail }));
      }
    };
    window.addEventListener('branding_updated', handleCustomBranding);

    return () => {
      window.removeEventListener('branding_updated', handleCustomBranding);
    };
  }, []);

  const setBrandingConfig = (config: Partial<BrandingConfig>) => {
    setBranding((prev) => {
      const updated = { ...prev, ...config };
      try {
        localStorage.setItem('app_branding_config', JSON.stringify(updated));
      } catch (e) {}
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
