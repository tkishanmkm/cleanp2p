'use client';
import type { P2PAd } from './types';
import { supabase } from '@/lib/supabaseClient';

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
  // 1. Fetch user directly with getUser() fallback
  const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

  if (userError || !currentUser) {
    console.error("Auth user error:", userError);
    alert("No active session found! Please refresh or log in again.");
    throw new Error(`Auth Error: No active session found. ${userError?.message || ''}`);
  }

  const publicAdId = generatePublicAdId();

  // 2. Perform Insert with explicit user_id and detailed error logging
  const { data, error } = await supabase
    .from('p2p_ads')
    .insert([
      {
        ...adData,
        public_ad_id: publicAdId,
        user_id: currentUser.id, // Explicitly attach authenticated user ID
        user_display_name: user.username,
        created_at: new Date().toISOString(),
      },
    ])
    .select();

  if (error) {
    console.error("Database Insert Error:", error);
    alert(`[DB Error ${error.code}]: ${error.message} - ${error.details || error.hint || ''}`);
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
    .update({ active, status: active ? 'ACTIVE' : 'INACTIVE' })
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
    .update({ active: false, status: 'DELETED' })
    .eq('id', adId)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function getMarketplaceAds(
  side: 'BUY' | 'SELL',
  coin: string = 'ALL',
  fiat: string = 'ALL',
  paymentMethod: string = 'ALL'
) {
  // P2P Inversion: To BUY crypto, show SELL ads. To SELL crypto, show BUY ads.
  const queryType = side === 'BUY' ? 'SELL' : 'BUY';

  let query = supabase
    .from('p2p_ads')
    .select('*')
    .eq('type', queryType)
    .ilike('status', 'active');

  if (coin && coin !== 'ALL') {
    query = query.eq('coin', coin.toUpperCase());
  }

  if (fiat && fiat !== 'ALL') {
    query = query.eq('fiat', fiat.toUpperCase());
  }

  if (paymentMethod && paymentMethod !== 'ALL') {
    // Array column containment check for payment_methods
    query = query.contains('payment_methods', [paymentMethod]);
  }

  const { data, error } = await query.order('price', { ascending: side === 'BUY' });

  if (error) {
    console.error('Error fetching marketplace ads:', error.message);
    return [];
  }

  return data || [];
}

export async function fetchMyAds() {
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    console.warn("No active session found when fetching My Ads");
    return [];
  }

  const { data, error } = await supabase
    .from('p2p_ads')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("My Ads fetch error:", error.message);
    throw error;
  }
  return data || [];
}

export async function createAd(formData: any) {
  // 1. Fetch user directly with getUser() fallback
  const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

  if (userError || !currentUser) {
    console.error("Auth user error:", userError);
    alert("No active session found! Please refresh or log in again.");
    throw new Error(`Auth Error: No active session found. ${userError?.message || ''}`);
  }

  const activeUser = currentUser;

  const adPayload = {
    user_id: activeUser.id,
    type: formData.type ? formData.type.toUpperCase() : (formData.adType ? formData.adType.toUpperCase() : 'BUY'), // 'BUY' or 'SELL'
    coin: formData.coin || formData.crypto || 'USDT',
    fiat: formData.fiat || formData.fiat_currency || 'INR',
    payment_methods: Array.isArray(formData.payment_methods) 
      ? formData.payment_methods 
      : [formData.payment_method || 'Bank Transfer'],
    pricing_type: formData.pricing_type || (formData.rateType === 'fixed' ? 'FIXED' : 'FLOAT'),
    price: Number(formData.price),
    min_amount: Number(formData.min_amount || formData.minAmount || 0),
    max_amount: Number(formData.max_amount || formData.maxAmount || 0),
  };

  // 2. Perform Insert with explicit user_id and detailed error logging
  const { data, error } = await supabase
    .from('p2p_ads')
    .insert([adPayload])
    .select();

  if (error) {
    console.error("Database Insert Error:", error);
    alert(`[DB Error ${error.code}]: ${error.message} - ${error.details || error.hint || ''}`);
    throw error;
  }

  alert("Ad created successfully!");
  return data;
}
