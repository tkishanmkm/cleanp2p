import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
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

    let ads: any[] = [];
    let queryError: any = null;

    // 1. Try querying p2p_ads view
    const { data: viewAds, error: viewError } = await supabase
      .from('p2p_ads')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!viewError && Array.isArray(viewAds)) {
      ads = viewAds;
    } else {
      queryError = viewError;
      console.warn('p2p_ads view query failed, trying ads table:', viewError?.message);

      // 2. Try querying ads base table
      const { data: tableAds, error: tableError } = await supabase
        .from('ads')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (!tableError && Array.isArray(tableAds)) {
        ads = tableAds;
        queryError = null;
      } else {
        queryError = tableError;
      }
    }

    // 3. Fallback to admin client if RLS is preventing read or if 0 ads returned but admin sees records
    if (ads.length === 0) {
      try {
        const admin = getSupabaseAdminClient();
        const { data: adminAds, error: adminErr } = await admin
          .from('ads')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (!adminErr && Array.isArray(adminAds) && adminAds.length > 0) {
          ads = adminAds;
          queryError = null;
        }
      } catch (adminEx) {
        console.warn('Admin fallback in my-ads failed:', adminEx);
      }
    }

    if (queryError && ads.length === 0) {
      return NextResponse.json({ error: queryError.message, ads: [] }, { status: 200 });
    }

    return NextResponse.json({ success: true, ads });
  } catch (err: any) {
    console.error('Error fetching user ads:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error', ads: [] }, { status: 500 });
  }
}
