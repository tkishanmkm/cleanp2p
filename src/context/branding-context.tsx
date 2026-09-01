'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase';

export interface BrandingConfig {
  appLogo?: string;
  appName?: string;
  primaryColor?: string;
  accentColor?: string;
}

interface BrandingContextType {
  branding: BrandingConfig;
  isLoading: boolean;
}

const defaultBranding: BrandingConfig = {
  appName: 'P2P Exchange',
  appLogo: '/logo.png',
};

const BrandingContext = createContext<BrandingContextType>({
  branding: defaultBranding,
  isLoading: true,
});

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingConfig>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    // Fetch branding configuration from Supabase
    async function fetchBranding() {
      try {
        const { data, error } = await supabase
          .from('app_config')
          .select('*')
          .eq('key', 'branding')
          .single();

        if (data && !error) {
          setBranding((prev) => ({ ...prev, ...data.value }));
        }
      } catch (err) {
        console.error('Error loading branding config from Supabase:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchBranding();

    // Subscribe to real-time branding updates via Supabase Realtime
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
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading }}>
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);
