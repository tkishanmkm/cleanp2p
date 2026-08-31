
"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import type { P2PAd } from "@/lib/types";
import { CreateAdForm } from "@/components/p2p/create-ad-form";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function EditAdPage() {
  const params = useParams();
  const { user } = useAuth();
  const { firestore } = useFirebase();
  const adId = Array.isArray(params.adId) ? params.adId[0] : params.adId;

  const adRef = useMemoFirebase(
    () => (adId && firestore ? doc(firestore, "p2p_ads", adId as string) : null),
    [adId, firestore]
  );
  const { data: ad, isLoading } = useDoc<P2PAd>(adRef);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!ad) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ad not found</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  // Ensure only the ad owner can edit
  if (user && ad.userId !== user.uid) {
     return (
      <Card>
        <CardHeader>
          <CardTitle>Unauthorized</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <div className="flex-1 rounded-lg">
        <CreateAdForm ad={ad} adType={ad.adType}/>
      </div>
    </>
  );
}
