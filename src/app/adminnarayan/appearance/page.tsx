'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { Loader2, Upload } from 'lucide-react';
import { useBranding, type BrandingConfig } from '@/context/branding-context';
import { useToast } from '@/hooks/use-toast';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase/client';

type LogoKey = keyof BrandingConfig | 'btcLogo' | 'ethLogo' | 'ltcLogo' | 'usdtLogo';

export default function AdminAppearancePage() {
  const { toast } = useToast();
  const { branding, isLoading: isBrandingLoading } = useBranding();

  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (branding) {
      setPreviews((prev) => ({ ...prev, ...(branding as any) }));
    }
  }, [branding]);

  const fileInputRefs: { [K in LogoKey]?: React.RefObject<HTMLInputElement | null> } = {
    appLogo: useRef<HTMLInputElement>(null),
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
        setPreviews((prev) => ({ ...prev, [key]: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase.from('app_config').upsert(
        {
          key: 'branding',
          value: previews,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

      if (error) {
        // If app_config table does not exist, save to localStorage
        localStorage.setItem('app_branding_config', JSON.stringify(previews));
      }

      toast({ title: 'Success', description: 'Appearance settings have been saved.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Save Failed', description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const logoSections: { key: LogoKey; title: string; CurrentLogo: React.ComponentType<{ className?: string }> }[] = [
    { key: 'appLogo', title: 'App Logo (Desktop & Mobile)', CurrentLogo: Logo },
    { key: 'btcLogo', title: 'Bitcoin (BTC)', CurrentLogo: BtcLogo },
    { key: 'ethLogo', title: 'Ethereum (ETH)', CurrentLogo: EthLogo },
    { key: 'ltcLogo', title: 'Litecoin (LTC)', CurrentLogo: LtcLogo },
    { key: 'usdtLogo', title: 'Tether (USDT)', CurrentLogo: UsdtLogo },
  ];

  const renderSection = (key: LogoKey, title: string, CurrentLogo: React.ComponentType<{ className?: string }>) => {
    const currentLogoSrc = previews[key];
    return (
      <div key={key} className="p-4 border rounded-lg flex items-center justify-between">
        <div className="flex items-center gap-4">
          {currentLogoSrc ? (
            <Image
              src={currentLogoSrc}
              alt={`${title} Logo`}
              width={key.includes('appLogo') ? 120 : 40}
              height={40}
              className={cn(!key.includes('appLogo') && 'h-10 w-10', 'object-contain')}
              unoptimized
            />
          ) : (
            <CurrentLogo className={cn(key.includes('appLogo') ? 'text-3xl' : 'h-10 w-10')} />
          )}
          <div>
            <p className="font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">Current Logo</p>
          </div>
        </div>
        <div>
          <Input
            type="file"
            ref={fileInputRefs[key] as any}
            className="hidden"
            accept="image/png, image/jpeg, image/jpg"
            onChange={(e) => handleFileChange(e, key)}
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRefs[key]?.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            Upload New
          </Button>
        </div>
      </div>
    );
  };

  if (isBrandingLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance Settings</CardTitle>
        <CardDescription>
          Update the logos for the application and supported cryptocurrencies. Changes will be reflected globally.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {logoSections.map((section) => renderSection(section.key, section.title, section.CurrentLogo))}
      </CardContent>
      <CardFooter className="border-t px-6 py-4">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save All Changes
        </Button>
      </CardFooter>
    </Card>
  );
}
