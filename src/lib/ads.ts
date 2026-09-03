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
  const publicAdId = generatePublicAdId();
  const payload = {
    ...adData,
    public_ad_id: publicAdId,
    user_display_name: user?.username || 'User',
    created_at: new Date().toISOString(),
  };

  return await handleCreateAd(payload);
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
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const res = await fetch(`/api/p2p/ads/${adId}`, {
      method: 'PATCH',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        status: active ? 'ACTIVE' : 'OFFLINE',
        active,
      }),
    });

    if (res.ok) {
      const json = await res.json();
      return json.data;
    }
  } catch (err) {
    console.warn('API PATCH failed, falling back to direct query:', err);
  }

  const { data, error } = await supabase
    .from('p2p_ads')
    .update({ active, status: active ? 'ACTIVE' : 'OFFLINE' })
    .eq('id', adId)
    .select();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function softDeleteAd(_db: any, adId: string) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const res = await fetch(`/api/p2p/ads/${adId}`, {
      method: 'DELETE',
      headers,
      credentials: 'include',
    });

    if (res.ok) {
      return { success: true };
    }
  } catch (err) {
    console.warn('API DELETE failed, falling back to direct query:', err);
  }

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
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const res = await fetch('/api/p2p/my-ads', {
      headers,
      credentials: 'include',
    });

    if (res.ok) {
      const json = await res.json();
      if (json.ads) return json.ads;
    }
  } catch (err) {
    console.warn('API fetchMyAds failed, falling back to direct query:', err);
  }

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

export const handleCreateAd = async (adData: any) => {
  // Clean payload: cast numeric columns and ensure booleans are boolean
  const cleanPayload = {
    ...adData,
    price: adData.price !== undefined && adData.price !== null && adData.price !== '' ? Number(adData.price) : null,
    margin: adData.margin !== undefined && adData.margin !== null && adData.margin !== '' ? Number(adData.margin) : null,
    min_amount: adData.min_amount !== undefined && adData.min_amount !== null && adData.min_amount !== '' ? Number(adData.min_amount) : null,
    max_amount: adData.max_amount !== undefined && adData.max_amount !== null && adData.max_amount !== '' ? Number(adData.max_amount) : null,
    // Ensure boolean flags are strictly boolean
    is_fixed: Boolean(adData.is_fixed),
  };

  // If fixed_rate is boolean, remove it so it doesn't trigger 22P02 on a NUMERIC column
  if (typeof (cleanPayload as any).fixed_rate === 'boolean') {
    delete (cleanPayload as any).fixed_rate;
  }

  // Retrieve session token if available to accompany credentials
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  // Use /api/p2p/ads for balance checks and limit capping
  const response = await fetch('/api/p2p/ads', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(cleanPayload),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Error creating ad:', result.realError || result.error);
    alert(`Failed: ${result.realError || result.error}`);
    throw new Error(result.realError || result.error || 'Failed to create ad');
  }

  console.log('Ad created successfully:', result.data);
  alert("Ad created successfully!");
  return result.data;
};

export async function createAd(formData: any) {
  const adPayload = {
    type: formData.type ? formData.type.toUpperCase() : (formData.adType ? formData.adType.toUpperCase() : 'BUY'), // 'BUY' or 'SELL'
    coin: formData.coin || formData.crypto || 'USDT',
    fiat: formData.fiat || formData.fiat_currency || 'INR',
    payment_methods: Array.isArray(formData.payment_methods) 
      ? formData.payment_methods 
      : [formData.payment_method || 'Bank Transfer'],
    pricing_type: formData.pricing_type || (formData.rateType === 'fixed' ? 'FIXED' : 'FLOAT'),
    price: formData.price !== undefined && formData.price !== null && formData.price !== '' ? Number(formData.price) : null,
    margin: formData.margin !== undefined && formData.margin !== null && formData.margin !== '' ? Number(formData.margin) : null,
    min_amount: formData.min_amount !== undefined && formData.min_amount !== null && formData.min_amount !== '' ? Number(formData.min_amount) : (formData.minAmount ? Number(formData.minAmount) : null),
    max_amount: formData.max_amount !== undefined && formData.max_amount !== null && formData.max_amount !== '' ? Number(formData.max_amount) : (formData.maxAmount ? Number(formData.maxAmount) : null),
    is_fixed: Boolean(formData.is_fixed || formData.rateType === 'fixed'),
    title: formData.title,
    description: formData.description,
  };

  return await handleCreateAd(adPayload);
}
