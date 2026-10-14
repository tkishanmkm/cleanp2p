import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { findAdById, resolveBothTargetRows } from '@/lib/ad-lookup';

export const dynamic = 'force-dynamic';

// GET: Fetch ad details with creator's live profile, reputation, and wallet balance
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const id = (resolvedParams.id || '').trim();

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
    );

    // 1. Fetch ad by id, public_ad_id, public_id, or ad_id using universal resolver
    const resolved = await findAdById(id);
    const ad = resolved?.ad || null;

    if (!ad) {
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
    const lastActive = creatorProfile?.last_seen || creatorProfile?.last_seen_at || creatorProfile?.last_active || creatorProfile?.updated_at || null;

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
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

    try {
      const { assertUserNotEmergencyFrozen } = await import('@/lib/user-freeze');
      await assertUserNotEmergencyFrozen(user.id);
    } catch (freezeErr: any) {
      return NextResponse.json(
        { error: freezeErr.message || 'Your account is under an emergency security freeze.', code: 'USER_EMERGENCY_FROZEN' },
        { status: 403 }
      );
    }

    // Resolve ad across ads / p2p_ads using universal resolver
    const resolved = await findAdById(id);
    const existingAd = resolved?.ad || null;

    if (!existingAd) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const adOwnerId = existingAd.user_id || existingAd.userId;
    if (adOwnerId && String(adOwnerId) !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden. You do not own this advertisement.' }, { status: 403 });
    }

    const rawBody = await request.json();

    // Sanitize payload data types
    const body: Record<string, any> = { ...rawBody };
    delete body.user_id;
    delete body.userId;

    if (body.price !== undefined && body.price !== null && body.price !== '') body.price = Number(body.price);
    if (body.margin !== undefined && body.margin !== null && body.margin !== '') {
      body.rate_percent = Number(body.margin);
      body.price_margin = Number(body.margin);
      delete body.margin;
    }
    if (body.min_amount !== undefined && body.min_amount !== null && body.min_amount !== '') body.min_amount = Number(body.min_amount);
    if (body.max_amount !== undefined && body.max_amount !== null && body.max_amount !== '') body.max_amount = Number(body.max_amount);
    if (body.min_limit !== undefined && body.min_limit !== null && body.min_limit !== '') body.min_limit = Number(body.min_limit);
    if (body.max_limit !== undefined && body.max_limit !== null && body.max_limit !== '') body.max_limit = Number(body.max_limit);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
    );

    const { p2pAdsRow, adsRow } = await resolveBothTargetRows(existingAd, id, supabaseAdmin);

    let p2pMutated = false;
    let adsMutated = false;
    let updatedResult: any = null;

    const hasStatus = body.status !== undefined || body.active !== undefined || body.is_active !== undefined;
    let newStatus: string | undefined = undefined;
    let isActive: boolean | undefined = undefined;

    if (hasStatus) {
      if (body.active !== undefined) {
        isActive = Boolean(body.active);
        newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
      } else if (body.is_active !== undefined) {
        isActive = Boolean(body.is_active);
        newStatus = isActive ? 'ACTIVE' : 'INACTIVE';
      } else if (body.status !== undefined) {
        newStatus = String(body.status).toUpperCase().trim();
        isActive = newStatus === 'ACTIVE';
      }
    }

    if (p2pAdsRow) {
      // Explicit allowlisted update payload for canonical public.p2p_ads
      const p2pPayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (newStatus !== undefined && isActive !== undefined) {
        p2pPayload.status = newStatus;
        p2pPayload.active = isActive;
      }

      if (body.price !== undefined) {
        p2pPayload.price = body.price;
        p2pPayload.unit_price = body.price;
      }
      if (body.min_limit !== undefined || body.min_amount !== undefined) {
        const minL = body.min_limit ?? body.min_amount;
        p2pPayload.min_limit = minL;
        p2pPayload.min_amount = minL;
      }
      if (body.max_limit !== undefined || body.max_amount !== undefined) {
        const maxL = body.max_limit ?? body.max_amount;
        p2pPayload.max_limit = maxL;
        p2pPayload.max_amount = maxL;
        p2pPayload.available_amount = maxL;
      }
      if (body.rate_percent !== undefined) {
        p2pPayload.rate_percent = body.rate_percent;
        p2pPayload.price_margin = body.rate_percent;
      }
      if (body.pricing_type !== undefined) p2pPayload.pricing_type = body.pricing_type;
      if (body.rate_type !== undefined) p2pPayload.rate_type = body.rate_type;
      if (body.payment_methods !== undefined) p2pPayload.payment_methods = body.payment_methods;
      if (body.terms_conditions !== undefined || body.terms !== undefined) p2pPayload.terms_conditions = body.terms_conditions || body.terms;
      if (body.offer_label !== undefined || body.label !== undefined) p2pPayload.offer_label = body.offer_label || body.label;
      if (body.offer_tags !== undefined || body.tags !== undefined) p2pPayload.offer_tags = body.offer_tags || body.tags;
      if (body.payment_window !== undefined || body.payment_window_minutes !== undefined) {
        const pw = Number(body.payment_window ?? body.payment_window_minutes);
        p2pPayload.payment_window = pw;
        p2pPayload.payment_window_minutes = pw;
        p2pPayload.payment_time_limit = pw;
      }
      if (body.require_full_name_verified !== undefined) p2pPayload.require_full_name_verified = Boolean(body.require_full_name_verified);
      if (body.require_verified_users !== undefined) p2pPayload.require_verified_users = Boolean(body.require_verified_users);
      if (body.min_completed_trades !== undefined) p2pPayload.min_completed_trades = parseInt(String(body.min_completed_trades), 10) || 0;

      // Ensure is_active NEVER reaches p2p_ads
      delete p2pPayload.is_active;

      const { data: p2pRes, error: p2pErr } = await supabaseAdmin
        .from('p2p_ads')
        .update(p2pPayload)
        .eq('id', p2pAdsRow.id)
        .select()
        .maybeSingle();

      if (!p2pErr && p2pRes) {
        p2pMutated = true;
        updatedResult = p2pRes;
      } else {
        console.error('[PATCH /api/p2p/ads/[id]] Canonical p2p_ads update failed:', p2pErr?.message);
      }
    }

    if (adsRow) {
      try {
        const adsPayload: Record<string, any> = {
          updated_at: new Date().toISOString(),
        };
        if (newStatus !== undefined && isActive !== undefined) {
          adsPayload.status = newStatus;
          adsPayload.is_active = isActive;
        }
        if (body.price !== undefined) adsPayload.price = body.price;
        if (body.min_limit !== undefined || body.min_amount !== undefined) adsPayload.min_limit = body.min_limit ?? body.min_amount;
        if (body.max_limit !== undefined || body.max_amount !== undefined) adsPayload.max_limit = body.max_limit ?? body.max_amount;
        if (body.payment_methods !== undefined) adsPayload.payment_methods = body.payment_methods;
        if (body.terms_conditions !== undefined || body.terms !== undefined) adsPayload.terms = body.terms_conditions || body.terms;
        if (body.offer_label !== undefined || body.label !== undefined) adsPayload.offer_label = body.offer_label || body.label;

        const { data: adsRes, error: adsErr } = await supabaseAdmin
          .from('ads')
          .update(adsPayload)
          .eq('id', adsRow.id)
          .select()
          .maybeSingle();

        if (!adsErr && adsRes) {
          adsMutated = true;
          if (!updatedResult) updatedResult = adsRes;
        } else {
          console.warn('[PATCH /api/p2p/ads/[id]] Legacy ads mirror update warning:', adsErr?.message);
        }
      } catch (legacyErr: any) {
        console.warn('[PATCH /api/p2p/ads/[id]] Legacy ads update exception:', legacyErr?.message);
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    // Canonical p2p_ads is authoritative. If p2pAdsRow exists, canonical p2p update must succeed.
    // If only legacy adsRow exists, ads update must succeed.
    const overallSuccess = p2pAdsRow ? p2pMutated : adsMutated;

    if (!overallSuccess) {
      console.error('[PATCH /api/p2p/ads/[id]] Target update failed:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
      return NextResponse.json({ error: 'Failed to update advertisement.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: updatedResult || existingAd });
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
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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

    // Resolve ad across ads / p2p_ads using universal resolver
    const resolved = await findAdById(id);
    const existingAd = resolved?.ad || null;

    if (!existingAd) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const adOwnerId = existingAd.user_id || existingAd.userId;
    if (adOwnerId && String(adOwnerId) !== String(user.id)) {
      return NextResponse.json({ error: 'Forbidden. You do not own this advertisement.' }, { status: 403 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key'
    );

    const { p2pAdsRow, adsRow } = await resolveBothTargetRows(existingAd, id, supabaseAdmin);

    let p2pMutated = false;
    let adsMutated = false;

    if (p2pAdsRow) {
      try {
        await supabaseAdmin
          .from('p2p_ads')
          .update({ status: 'DELETED', active: false, updated_at: new Date().toISOString() })
          .eq('id', p2pAdsRow.id);
      } catch (softErr: any) {
        console.warn('[DELETE /api/p2p/ads/[id]] p2p_ads soft-delete warning:', softErr?.message);
      }

      const { data: p2pDel, error: p2pErr } = await supabaseAdmin
        .from('p2p_ads')
        .delete()
        .eq('id', p2pAdsRow.id)
        .select('id');

      if (!p2pErr && p2pDel && p2pDel.length > 0) {
        p2pMutated = true;
      } else {
        const { data: p2pCheck } = await supabaseAdmin
          .from('p2p_ads')
          .select('status')
          .eq('id', p2pAdsRow.id)
          .maybeSingle();
        if (p2pCheck && p2pCheck.status === 'DELETED') {
          p2pMutated = true;
        }
      }
    }

    if (adsRow) {
      try {
        await supabaseAdmin
          .from('ads')
          .update({ status: 'DELETED', is_active: false, updated_at: new Date().toISOString() })
          .eq('id', adsRow.id);
      } catch (softErr: any) {
        console.warn('[DELETE /api/p2p/ads/[id]] Legacy ads soft-delete warning:', softErr?.message);
      }

      const { data: adsDel, error: adsErr } = await supabaseAdmin
        .from('ads')
        .delete()
        .eq('id', adsRow.id)
        .select('id');

      if (!adsErr && adsDel && adsDel.length > 0) {
        adsMutated = true;
      } else {
        const { data: adsCheck } = await supabaseAdmin
          .from('ads')
          .select('status')
          .eq('id', adsRow.id)
          .maybeSingle();
        if (adsCheck && adsCheck.status === 'DELETED') {
          adsMutated = true;
        }
      }
    }

    if (!p2pAdsRow && !adsRow) {
      return NextResponse.json({ error: 'Advertisement not found.' }, { status: 404 });
    }

    const overallDeleteSuccess = p2pAdsRow ? p2pMutated : adsMutated;

    if (!overallDeleteSuccess) {
      console.error('[DELETE /api/p2p/ads/[id]] Target delete failed:', { p2pRowId: p2pAdsRow?.id, p2pMutated, adsRowId: adsRow?.id, adsMutated });
      return NextResponse.json({ error: 'Failed to delete advertisement record.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Ad deleted successfully.' });
  } catch (err: any) {
    console.error('Error deleting ad:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
