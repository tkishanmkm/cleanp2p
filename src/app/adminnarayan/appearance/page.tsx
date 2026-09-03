'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { Loader2, Upload, Monitor, Smartphone, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { useBranding, type BrandingConfig } from '@/context/branding-context';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';

type LogoKey = 'appLogoDesktop' | 'appLogoMobile' | 'btcLogo' | 'ethLogo' | 'ltcLogo' | 'usdtLogo';

interface LogoFieldConfig {
  key: LogoKey;
  title: string;
  description: string;
  type: 'desktop_logo' | 'mobile_logo' | 'crypto';
  fallbackIcon?: React.ComponentType<{ className?: string }>;
}

export default function AdminAppearancePage() {
  const { toast } = useToast();
  const { branding, isLoading: isBrandingLoading, setBrandingConfig } = useBranding();

  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [urlInputs, setUrlInputs] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (branding) {
      setPreviews((prev) => ({
        ...prev,
        appLogoDesktop: branding.appLogoDesktop || branding.appLogo || '',
        appLogoMobile: branding.appLogoMobile || '',
        btcLogo: branding.btcLogo || '',
        ethLogo: branding.ethLogo || '',
        ltcLogo: branding.ltcLogo || '',
        usdtLogo: branding.usdtLogo || '',
      }));
    }
  }, [branding]);

  const fileInputRefs: { [K in LogoKey]?: React.RefObject<HTMLInputElement | null> } = {
    appLogoDesktop: useRef<HTMLInputElement>(null),
    appLogoMobile: useRef<HTMLInputElement>(null),
    btcLogo: useRef<HTMLInputElement>(null),
    ethLogo: useRef<HTMLInputElement>(null),
    ltcLogo: useRef<HTMLInputElement>(null),
    usdtLogo: useRef<HTMLInputElement>(null),
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, key: LogoKey) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setPreviews((prev) => ({ ...prev, [key]: result }));
        setUrlInputs((prev) => ({ ...prev, [key]: '' }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleUrlApply = (key: LogoKey) => {
    const url = urlInputs[key]?.trim();
    if (url) {
      setPreviews((prev) => ({ ...prev, [key]: url }));
    }
  };

  const handleClear = (key: LogoKey) => {
    setPreviews((prev) => ({ ...prev, [key]: '' }));
    setUrlInputs((prev) => ({ ...prev, [key]: '' }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Sync React context and local storage immediately
      setBrandingConfig(previews);

      // 2. Dispatch custom event for real-time update in open tabs
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('app_branding_config', JSON.stringify(previews));
        window.dispatchEvent(new CustomEvent('branding_updated', { detail: previews }));
      }

      // 3. Persist to app_config table if available
      try {
        await supabase.from('app_config').upsert(
          {
            key: 'branding',
            value: previews,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      } catch (dbErr) {
        console.warn('Database app_config sync notice:', dbErr);
      }

      toast({
        title: 'Settings Saved',
        description: 'Desktop, mobile, and asset branding settings have been updated.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const logoSections: LogoFieldConfig[] = [
    {
      key: 'appLogoDesktop',
      title: 'App Logo (Desktop)',
      description: 'Primary high-resolution brand logo displayed on desktop navigation bars and wide screens (recommended: 150x40px PNG/SVG).',
      type: 'desktop_logo',
    },
    {
      key: 'appLogoMobile',
      title: 'App Logo (Mobile)',
      description: 'Compact icon or brand emblem optimized for mobile viewports and mobile headers (recommended: 40x40px square PNG/SVG).',
      type: 'mobile_logo',
    },
    {
      key: 'btcLogo',
      title: 'Bitcoin (BTC)',
      description: 'Asset badge icon for Bitcoin wallet and trade displays.',
      type: 'crypto',
      fallbackIcon: BtcLogo,
    },
    {
      key: 'ethLogo',
      title: 'Ethereum (ETH)',
      description: 'Asset badge icon for Ethereum wallet and trade displays.',
      type: 'crypto',
      fallbackIcon: EthLogo,
    },
    {
      key: 'ltcLogo',
      title: 'Litecoin (LTC)',
      description: 'Asset badge icon for Litecoin wallet and trade displays.',
      type: 'crypto',
      fallbackIcon: LtcLogo,
    },
    {
      key: 'usdtLogo',
      title: 'Tether (USDT)',
      description: 'Asset badge icon for Tether USDT wallet and trade displays.',
      type: 'crypto',
      fallbackIcon: UsdtLogo,
    },
  ];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto text-slate-100">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Appearance & Branding</h1>
          <p className="text-xs text-slate-400 mt-1">
            Configure independent brand logos for desktop and mobile devices, and customize cryptocurrency icons across the platform.
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Save All Changes
        </Button>
      </div>

      <div className="space-y-6">
        {/* App Logos Card */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base text-white">Platform Application Logos</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Desktop and mobile interfaces have dedicated, independent logo controls. The old combined logo setting has been retired.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {logoSections.filter(s => s.type !== 'crypto').map((section) => {
              const currentSrc = previews[section.key];
              const isDesktop = section.key === 'appLogoDesktop';

              return (
                <div key={section.key} className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
                        {isDesktop ? (
                          <Monitor className="w-5 h-5 text-blue-400" />
                        ) : (
                          <Smartphone className="w-5 h-5 text-purple-400" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">{section.title}</h3>
                        <p className="text-xs text-slate-400 max-w-md">{section.description}</p>
                      </div>
                    </div>

                    {/* Preview Box */}
                    <div className="h-14 min-w-[140px] px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center">
                      {currentSrc ? (
                        <Image
                          src={currentSrc}
                          alt={section.title}
                          width={isDesktop ? 120 : 36}
                          height={36}
                          className="object-contain max-h-9 w-auto"
                          unoptimized
                        />
                      ) : (
                        <span className="text-xs text-slate-500 font-mono italic">No custom logo</span>
                      )}
                    </div>
                  </div>

                  {/* Controls: Upload & URL */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/60">
                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Upload Image File
                      </label>
                      <input
                        type="file"
                        ref={fileInputRefs[section.key] as any}
                        onChange={(e) => handleFileChange(e, section.key)}
                        accept="image/*"
                        className="hidden"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRefs[section.key]?.current?.click()}
                          className="w-full bg-slate-900 border-slate-700 hover:bg-slate-800 text-xs text-slate-200"
                        >
                          <Upload className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
                          Choose File...
                        </Button>
                        {currentSrc && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleClear(section.key)}
                            className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs"
                          >
                            Clear
                          </Button>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                        Or Enter Image URL
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="url"
                          placeholder="https://example.com/logo.png"
                          value={urlInputs[section.key] || ''}
                          onChange={(e) => setUrlInputs({ ...urlInputs, [section.key]: e.target.value })}
                          className="h-8 bg-slate-900 border-slate-700 text-xs text-white"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleUrlApply(section.key)}
                          className="h-8 px-3 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200"
                        >
                          Set
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Cryptocurrency Logos Card */}
        <Card className="bg-slate-900 border-slate-800 text-slate-100">
          <CardHeader>
            <CardTitle className="text-base text-white">Cryptocurrency Asset Logos</CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Customize asset icons for supported currencies across wallets, trade offers, and settlement receipts.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {logoSections.filter(s => s.type === 'crypto').map((section) => {
              const currentSrc = previews[section.key];
              const FallbackIcon = section.fallbackIcon;

              return (
                <div key={section.key} className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
                      {currentSrc ? (
                        <Image
                          src={currentSrc}
                          alt={section.title}
                          width={28}
                          height={28}
                          className="object-contain h-7 w-7"
                          unoptimized
                        />
                      ) : FallbackIcon ? (
                        <FallbackIcon className="h-7 w-7" />
                      ) : null}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-white">{section.title}</h4>
                      <p className="text-xs text-slate-400">{section.description}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRefs[section.key] as any}
                      onChange={(e) => handleFileChange(e, section.key)}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRefs[section.key]?.current?.click()}
                      className="bg-slate-900 border-slate-700 hover:bg-slate-800 text-xs text-slate-300"
                    >
                      <Upload className="w-3 h-3 mr-1 text-slate-400" />
                      Upload
                    </Button>
                    {currentSrc && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleClear(section.key)}
                        className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30"
                      >
                        Reset
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
          <CardFooter className="flex justify-end pt-2 border-t border-slate-800/80">
            <Button onClick={handleSave} disabled={isSaving} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs">
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save Appearance Settings
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
