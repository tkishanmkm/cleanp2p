import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset')?.trim().toUpperCase();
  const fiat = searchParams.get('fiat')?.trim().toUpperCase();

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    let query = supabaseAdmin
      .from('crypto_market_prices')
      .select('asset_symbol, fiat_symbol, price_in_fiat, updated_at');

    if (asset) {
      query = query.eq('asset_symbol', asset);
    }
    if (fiat) {
      query = query.eq('fiat_symbol', fiat);
    }

    const { data: prices, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      prices: prices || [],
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || 'Failed to fetch prices' }, { status: 500 });
  }
}
