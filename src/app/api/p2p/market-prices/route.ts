import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Server-side market price freshness TTL: 10 minutes (600,000 ms)
const PRICE_FRESHNESS_TTL_MS = 10 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const asset = searchParams.get('asset')?.trim().toUpperCase();
  const fiat = searchParams.get('fiat')?.trim().toUpperCase() || 'USD';

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
      console.error('[Market Prices API] Database query error:', error);
      return NextResponse.json(
        {
          success: false,
          error: 'DATABASE_QUERY_ERROR',
          message: 'Unable to query crypto market prices from database.',
        },
        { status: 500 }
      );
    }

    if (!prices || prices.length === 0) {
      // Do NOT invent fake fallback prices. Return structured response indicating unavailable.
      return NextResponse.json(
        {
          success: false,
          error: 'PRICE_UNAVAILABLE',
          message: `Live market prices for ${asset || 'assets'} in ${fiat} are not yet synced.`,
          prices: [],
          source: 'database',
        },
        { status: 404 }
      );
    }

    const now = Date.now();
    const formattedPrices = prices.map((p) => {
      const updatedAtMs = p.updated_at ? new Date(p.updated_at).getTime() : 0;
      const ageMs = now - updatedAtMs;
      const isStale = ageMs > PRICE_FRESHNESS_TTL_MS;

      return {
        asset_symbol: p.asset_symbol,
        fiat_symbol: p.fiat_symbol,
        price_in_fiat: Number(p.price_in_fiat),
        updated_at: p.updated_at,
        is_stale: isStale,
        age_seconds: Math.round(ageMs / 1000),
      };
    });

    return NextResponse.json({
      success: true,
      prices: formattedPrices,
      source: 'database',
    });
  } catch (err: any) {
    console.error('[Market Prices API] Unexpected error:', err);
    return NextResponse.json(
      {
        success: false,
        error: 'PRICE_UNAVAILABLE',
        message: err.message || 'Internal server error while resolving market prices.',
        prices: [],
        source: 'database',
      },
      { status: 500 }
    );
  }
}
