import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = (searchParams.get('q') || '').trim().replace(/^@/, '').slice(0, 64);

    if (!query || query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const admin = getSupabaseAdminClient();
    // Escape LIKE wildcards so user input is treated as a literal username fragment.
    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');

    const { data: profiles, error } = await admin
      .from('public_profiles')
      .select('id, username, avatar_url, photo_url, is_trading_eligible')
      .ilike('username', `%${escapedQuery}%`)
      .neq('id', user.id)
      .limit(8);

    if (error) {
      console.error('Error searching profiles:', error);
      return NextResponse.json({ error: 'Unable to search users' }, { status: 500 });
    }

    // Never enumerate Auth users or expose email-derived identities as a fallback.
    return NextResponse.json({ users: profiles || [] });
  } catch (err: any) {
    console.error('GET /api/users/search error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
