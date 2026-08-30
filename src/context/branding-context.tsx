'use client';

import React, { createContext, useContext, ReactNode, useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';

export interface BrandingConfig {
  appLogo?: string;
  appLogoMobile?: string;
  btcLogo?: string;
  ethLogo?: string;
  ltcLogo?: string;
  usdtLogo?: string;
}

interface BrandingContextType {
  branding: BrandingConfig | null;
  isLoading: boolean;
}

const BrandingContext = createContext<BrandingContextType | undefined>(undefined);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { firestore } = useFirebase();
  const [branding, setBranding] = useState<BrandingConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // The useFirebase hook now correctly handles the availability of firestore.
    // We wait until the firestore instance is available before trying to use it.
    if (!firestore) {
      // Keep loading until firestore is available.
      setIsLoading(true);
      return;
    }

    const brandingRef = doc(firestore, '_config', 'branding');
    const unsubscribe = onSnapshot(brandingRef, (doc) => {
      if (doc.exists()) {
        setBranding(doc.data() as BrandingConfig);
      } else {
        setBranding(null);
      }
      setIsLoading(false);
    }, (error) => {
      console.error("BrandingProvider fetch error:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [firestore]); // The effect now correctly depends on the firestore instance.

  const value = { branding, isLoading };

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  const context = useContext(BrandingContext);
  if (context === undefined) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return context;
}
