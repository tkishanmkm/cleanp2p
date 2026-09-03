'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

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
  appName: 'P2P Exchange',
  appLogo: '',
  appLogoDesktop: '',
  appLogoMobile: '',
};

const BrandingContext = createContext<BrandingContextType>({
  branding: defaultBranding,
  isLoading: true,
  setBrandingConfig: () => {},
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

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

    // 2. Fetch branding configuration from Supabase
    async function fetchBranding() {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('*')
          .eq('key', 'branding')
          .single();

        if (data && !error && data.value) {
          setBranding((prev) => ({ ...prev, ...data.value }));
        }
      } catch (err) {
        console.warn('Notice loading branding config from Supabase:', err);
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

    // 4. Subscribe to real-time branding updates via Supabase Realtime if table exists
    const channel = supabase
      .channel('branding-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_config',
          filter: 'key=eq.branding',
        },
        (payload) => {
          if (payload.new && 'value' in payload.new) {
            setBranding((prev) => ({ ...prev, ...(payload.new as any).value }));
          }
        }
      )
      .subscribe();

    return () => {
      window.removeEventListener('branding_updated', handleCustomBranding);
      supabase.removeChannel(channel);
    };
  }, [supabase]);

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
