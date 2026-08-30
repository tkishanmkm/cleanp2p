
'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function InitiateTradeRedirectPage() {
  const router = useRouter();
  const params = useParams();
  const adId = Array.isArray(params.adId) ? params.adId[0] : params.adId;

  useEffect(() => {
    if (adId) {
      router.replace(`/ad/${adId}`);
    } else {
        // If there's no adId, maybe redirect to a generic page
        router.replace('/buy');
    }
  }, [adId, router]);

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="ml-4 text-muted-foreground">Redirecting...</p>
    </div>
  );
}
