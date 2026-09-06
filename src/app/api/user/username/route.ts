import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const RESERVED_USERNAMES = ['admin', 'support', 'help', 'system', 'official', 'security', 'p2p'];

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { newUsername } = await req.json();
    const normalized = newUsername?.trim().toLowerCase();

    // 1. Length & Format Checks
    const usernameRegex = /^[a-z0-9._]{5,25}$/;
    if (!normalized || !usernameRegex.test(normalized)) {
      return NextResponse.json({
        error: 'Username must be between 5 and 25 characters and contain only lowercase letters, numbers, dots, and underscores.',
      }, { status: 400 });
    }

    // 2. Reserved List Check
    if (RESERVED_USERNAMES.includes(normalized)) {
      return NextResponse.json({ error: 'This username is reserved by the system.' }, { status: 400 });
    }

    // 3. Fetch Current User Metadata
    const { data: profile } = await supabase
      .from('profiles')
      .select('username_changes_remaining, username')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }

    if (profile.username === normalized) {
      return NextResponse.json({ error: 'New username must be different from current username.' }, { status: 400 });
    }

    if (profile.username_changes_remaining <= 0) {
      return NextResponse.json({ error: 'You have reached the maximum allowed username changes.' }, { status: 403 });
    }

    // 4. Duplicate Check
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', normalized)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Username is already taken by another trader.' }, { status: 409 });
    }

    // 5. Atomic Update
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        username: normalized,
        username_changes_remaining: profile.username_changes_remaining - 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to update username. Try again.' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      username: normalized,
      remainingChanges: profile.username_changes_remaining - 1,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
