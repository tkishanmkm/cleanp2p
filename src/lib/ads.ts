'use client';
import type { P2PAd } from './types';
import { supabase } from '@/lib/supabase/client';
import { createClient } from '@/lib/supabase';

function generatePublicAdId() {
  const prefix = 'AD-';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return prefix + result;
}

export async function createP2PAd(
  _db: any,
  adData: Omit<P2PAd, 'id' | 'createdAt' | 'user' | 'userId' | 'publicAdId'>,
  user: {
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
  }
) {
  // 1. Get current active session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.user) {
    console.error("Auth session error:", sessionError);
    alert(`Auth Error: No active session found. ${sessionError?.message || ''}`);
    throw new Error(`Auth Error: No active session found. ${sessionError?.message || ''}`);
  }

  const publicAdId = generatePublicAdId();

  // 2. Perform Insert with explicit user_id and detailed error logging
  const { data, error } = await supabase
    .from('p2p_ads')
    .insert([
      {
        ...adData,
        public_ad_id: publicAdId,
        user_id: session.user.id, // Explicitly attach authenticated user ID
        user_display_name: user.username,
        created_at: new Date().toISOString(),
      },
    ])
    .select();

  if (error) {
    // THIS WILL PRINT THE REAL ERROR IN CONSOLE AND ALERT
    console.error("Database error creating ad:", error);
    alert(`Real Database Error [${error.code}]: ${error.message} - ${error.details || error.hint || ''}`);
    throw error;
  }

  alert("Ad created successfully!");
  return data?.[0] || data;
}

export async function updateAd(_db: any, adId: string, adData: Partial<Omit<P2PAd, 'id' | 'createdAt' | 'user' | 'userId' | 'publicAdId'>>) {
  const { data, error } = await supabase
    .from('p2p_ads')
    .update(adData)
    .eq('id', adId)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function updateAdStatus(_db: any, adId: string, active: boolean) {
  const { data, error } = await supabase
    .from('p2p_ads')
    .update({ active })
    .eq('id', adId)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function softDeleteAd(_db: any, adId: string) {
  const { data, error } = await supabase
    .from('p2p_ads')
    .update({ active: false, deleted_at: new Date().toISOString() })
    .eq('id', adId)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function createAd(formData: any) {
  // 1. Get current active session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.user) {
    console.error("Auth session error:", sessionError);
    alert(`Auth Error: No active session found. ${sessionError?.message || ''}`);
    throw new Error(`Auth Error: No active session found. ${sessionError?.message || ''}`);
  }

  // 2. Perform Insert with explicit user_id and detailed error logging
  const { data, error } = await supabase
    .from('p2p_ads')
    .insert([
      {
        ...formData,
        user_id: session.user.id, // Explicitly attach authenticated user ID
      }
    ])
    .select();

  if (error) {
    // THIS WILL PRINT THE REAL ERROR IN CONSOLE AND ALERT
    console.error("Database error creating ad:", error);
    alert(`Real Database Error [${error.code}]: ${error.message} - ${error.details || error.hint || ''}`);
    throw error;
  }

  alert("Ad created successfully!");
  return data;
}
