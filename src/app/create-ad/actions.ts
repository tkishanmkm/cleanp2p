'use server';

import { createClient } from '@/lib/supabase/server';
import { ActionResponse } from '@/types/actions';

export async function createAd(formData: {
  type: string;
  crypto: string;
  fiat: string;
  price: number;
  totalAmount: number;
  minLimit: number;
  maxLimit: number;
  paymentMethods: string[];
  terms?: string;
  autoReply?: string;
}): Promise<ActionResponse<any>> {
  try {
    const supabase = await createClient();

    // 1. Get current authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        data: null,
        error: { message: 'You must be logged in to create an ad.', code: '401' },
      };
    }

    // 2. Insert directly into base table 'ads' (NOT the view)
    const { data: newAd, error: insertError } = await supabase
      .from('ads')
      .insert({
        user_id: user.id,
        type: formData.type?.toUpperCase() || 'BUY',
        asset_symbol: formData.crypto,
        fiat_symbol: formData.fiat,
        price: Number(formData.price),
        total_amount: Number(formData.totalAmount),
        min_limit: Number(formData.minLimit),
        max_limit: Number(formData.maxLimit),
        payment_methods: formData.paymentMethods || [],
        terms: formData.terms || '',
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Supabase ad insert error:', insertError);
      return {
        data: null,
        error: { message: insertError.message, code: insertError.code },
      };
    }

    return { data: newAd, error: null };
  } catch (err: any) {
    console.error('Unhandled createAd error:', err);
    return {
      data: null,
      error: { message: err?.message || 'An unexpected server error occurred.', code: '500' },
    };
  }
}
