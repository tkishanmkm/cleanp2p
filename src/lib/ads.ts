

'use client';
import { Firestore, collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import type { P2PAd, CryptoCurrency } from './types';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { createClient } from '@/lib/supabase';

function generatePublicAdId() {
  const prefix = "AD-";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + result;
}

export async function createP2PAd(db: Firestore, adData: Omit<P2PAd, 'id' | 'createdAt' | 'user' | 'userId' | 'publicAdId'>, user: {
    id: string;
    username: string;
    country?: string;
    feedbackScore: number;
    positiveFeedback: number;
    negativeFeedback: number;
    completedTrades: number;
    photoURL?: string;
    badges?: string[];
    lastActive?: string;
}) {
  const adsCollection = collection(db, 'p2p_ads');
  
  const userPayload = {
      username: user.username,
      ...(user.country && { country: user.country }),
      feedbackScore: user.feedbackScore,
      positiveFeedback: user.positiveFeedback,
      negativeFeedback: user.negativeFeedback,
      completedTrades: user.completedTrades,
      photoURL: user.photoURL || "",
      badges: user.badges || [],
      lastActive: user.lastActive || new Date().toISOString(),
  }

  const dataToCreate = {
    ...adData,
    publicAdId: generatePublicAdId(),
    userId: user.id,
    user: userPayload,
    createdAt: new Date().toISOString()
  };

  try {
    const docRef = await addDoc(adsCollection, dataToCreate);
    return docRef;
  } catch (error) {
    console.error("Error creating P2P Ad: ", error);
    
    errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: adsCollection.path,
          operation: 'create',
          requestResourceData: dataToCreate,
        })
      )
    throw error;
  }
}

export async function updateAd(db: Firestore, adId: string, adData: Partial<Omit<P2PAd, 'id' | 'createdAt' | 'user' | 'userId' | 'publicAdId'>>) {
    const adRef = doc(db, 'p2p_ads', adId);
    await updateDoc(adRef, adData);
}

export async function updateAdStatus(db: Firestore, adId: string, active: boolean) {
    const adRef = doc(db, 'p2p_ads', adId);
    await updateDoc(adRef, { active });
}

// Soft delete by marking as inactive
export async function softDeleteAd(db: Firestore, adId: string) {
    const adRef = doc(db, 'p2p_ads', adId);
    await updateDoc(adRef, { active: false, deletedAt: new Date().toISOString() });
}

export async function createAd(formData: any) {
  const supabase = createClient();
  
  // 1. Get current authenticated user
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("You must be logged in to create an ad.");
  }

  // 2. Insert ad into p2p_ads with user_id attached
  const { data, error } = await supabase
    .from('p2p_ads')
    .insert([
      {
        ...formData,
        user_id: user.id, // Must match auth.uid() in RLS policy
      }
    ])
    .select();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
