import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const RESERVED_USERNAMES = ['admin', 'support', 'help', 'system', 'p2p', 'official', 'security'];

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { username } = await req.json();
    const normalized = username?.trim().toLowerCase();

    if (!normalized || !/^[a-z0-9._]{5,25}$/.test(normalized)) {
      return NextResponse.json({ available: false, reason: 'Must be 5-25 chars (lowercase letters, numbers, dots, underscores).' });
    }

    if (RESERVED_USERNAMES.includes(normalized)) {
      return NextResponse.json({ available: false, reason: 'Reserved username.' });
    }

    // Check availability in Supabase
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', normalized)
      .neq('id', user.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ available: false, reason: 'Username is already taken.' });
    }

    return NextResponse.json({ available: true });
  } catch (err) {
    return NextResponse.json({ available: false, reason: 'Server error checking availability.' }, { status: 500 });
  }
}
