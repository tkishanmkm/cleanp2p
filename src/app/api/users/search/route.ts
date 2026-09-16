import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = (searchParams.get('q') || '').trim().replace(/^@/, '');

    if (!query || query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    const admin = getSupabaseAdminClient();

    // Query profiles using case-insensitive search
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, username, avatar_url, photo_url, is_banned, is_restricted, account_status')
      .ilike('username', `%${query}%`)
      .neq('id', user.id)
      .limit(8);

    if (error) {
      console.error('Error searching profiles:', error);
      return NextResponse.json({ users: [] });
    }

    // Also fallback check in Auth if less than 1 result found
    let combinedUsers = profiles || [];
    if (combinedUsers.length === 0) {
      try {
        const { data: authData } = await admin.auth.admin.listUsers();
        if (authData?.users) {
          const matched = authData.users.filter((u) => {
            if (u.id === user.id) return false;
            const email = u.email?.toLowerCase() || '';
            const emailPrefix = email.split('@')[0];
            const metaUsername = (u.user_metadata?.username || '').toLowerCase();
            const qLower = query.toLowerCase();
            return email.includes(qLower) || emailPrefix.includes(qLower) || metaUsername.includes(qLower);
          }).slice(0, 5);

          for (const m of matched) {
            const uName = m.user_metadata?.username || m.email?.split('@')[0] || `user_${m.id.slice(0, 6)}`;
            combinedUsers.push({
              id: m.id,
              username: uName,
              avatar_url: null,
              photo_url: null,
              is_banned: false,
              is_restricted: false,
              account_status: 'ACTIVE',
            });
          }
        }
      } catch (authErr) {
        console.warn('Auth user list search notice:', authErr);
      }
    }

    return NextResponse.json({ users: combinedUsers });
  } catch (err: any) {
    console.error('GET /api/users/search error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
