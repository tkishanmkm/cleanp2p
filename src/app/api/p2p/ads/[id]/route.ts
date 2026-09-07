import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// GET: Fetch ad details with creator's live profile, reputation, and wallet balance
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
    );

    // 1. Fetch ad by id or public_ad_id
    const { data: ad, error: adError } = await supabaseAdmin
      .from('p2p_ads')
      .select('*')
      .or(`id.eq.${id},public_ad_id.eq.${id}`)
      .maybeSingle();

    if (adError || !ad) {
      return NextResponse.json({ error: 'Advertisement not found' }, { status: 404 });
    }

    const creatorId = ad.user_id || ad.userId;
    let creatorProfile: any = null;

    if (creatorId) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', creatorId)
        .maybeSingle();
      if (prof) {
        creatorProfile = prof;
      }
    }

    // Fallback: If not found by id, try matching by username/display name
    if (!creatorProfile && ad.user_display_name) {
      const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .ilike('username', ad.user_display_name)
        .maybeSingle();
      if (prof) {
        creatorProfile = prof;
      }
    }

    // Fetch creator's wallet balance for the ad coin
    let creatorBalance: number | null = null;
    const coin = (ad.crypto || ad.coin || ad.asset || 'USDT').toUpperCase();

    if (creatorId) {
      try {
        const { data: wallet } = await supabaseAdmin
          .from('user_wallets')
          .select('available_balance, balance, locked_balance')
          .eq('user_id', creatorId)
          .ilike('asset_symbol', coin)
          .maybeSingle();

        if (wallet) {
          const avail = Number(wallet.available_balance ?? (Number(wallet.balance || 0) - Number(wallet.locked_balance || 0)));
          creatorBalance = Math.max(0, avail);
        } else if (creatorProfile) {
          const colKey = `${coin.toLowerCase()}_balance`;
          if (creatorProfile[colKey] !== undefined) {
            creatorBalance = Number(creatorProfile[colKey] || 0);
          }
        }
      } catch (wErr) {
        console.warn('Wallet balance fetch error in /api/p2p/ads/[id]:', wErr);
      }
    }

    // STRICT USERNAME ENFORCEMENT: lowercase letters, numbers, dot, underscore only
    const username = creatorProfile?.username || ad.user_display_name || 'trader';
    const lastActive = creatorProfile?.last_active || creatorProfile?.last_seen_at || creatorProfile?.updated_at || null;

    return NextResponse.json({
      ad: {
        ...ad,
        user: {
          id: creatorId,
          username,
          avatar_url: creatorProfile?.avatar_url || creatorProfile?.photo_url || null,
          photo_url: creatorProfile?.avatar_url || creatorProfile?.photo_url || null,
          created_at: creatorProfile?.created_at || ad.created_at,
          last_seen_at: lastActive,
          last_active: lastActive,
          completed_trades: creatorProfile?.completed_trades ?? 0,
          positive_feedback: creatorProfile?.positive_feedback ?? 0,
          negative_feedback: creatorProfile?.negative_feedback ?? 0,
          avg_release_time: creatorProfile?.avg_release_time || null,
          avg_release_minutes: creatorProfile?.avg_release_minutes || null,
          avg_pay_time: creatorProfile?.avg_pay_time || null,
          avg_payment_minutes: creatorProfile?.avg_payment_minutes || null,
        },
        creatorCryptoBalance: creatorBalance,
      },
    });
  } catch (err: any) {
    console.error('Error in GET /api/p2p/ads/[id]:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// PATCH: Edit ad details or toggle status (ACTIVE / OFFLINE)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    const cookieHeader = cookies();
    const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    // Support Bearer token header if provided by frontend
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();

    // Sanitize payload data types
    const body: Record<string, any> = { ...rawBody };
    if (body.price !== undefined && body.price !== null && body.price !== '') body.price = Number(body.price);
    if (body.margin !== undefined && body.margin !== null && body.margin !== '') body.margin = Number(body.margin);
    if (body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== '') body.min_amount = Number(body.min_amount);
    if (body.max_amount !== undefined && body.max_amount !== null && body.max_amount !== '') body.max_amount = Number(body.max_amount);
    if (body.min_limit !== undefined && body.min_limit !== null && body.min_limit !== '') body.min_limit = Number(body.min_limit);
    if (body.max_limit !== undefined && body.max_limit !== null && body.max_limit !== '') body.max_limit = Number(body.max_limit);
    if (body.is_fixed !== undefined) body.is_fixed = Boolean(body.is_fixed);
    if (typeof body.fixed_rate === 'boolean') delete body.fixed_rate;

    const { data, error } = await supabase
      .from('p2p_ads')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error('Error updating ad:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Remove an ad
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;

    const cookieHeader = cookies();
    const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    // Support Bearer token header if provided by frontend
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

    let user = null;
    let authError: any = null;

    if (bearerToken) {
      const tokenAuth = await supabase.auth.getUser(bearerToken);
      user = tokenAuth.data?.user;
      authError = tokenAuth.error;
    }

    if (!user) {
      const cookieAuth = await supabase.auth.getUser();
      user = cookieAuth.data?.user;
      authError = cookieAuth.error;
    }

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('p2p_ads')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting ad:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
