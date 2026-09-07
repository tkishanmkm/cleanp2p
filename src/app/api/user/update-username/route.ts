import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

export async function PATCH(request: NextRequest) {
  const cookieHeader = cookies();
  const cookieStore = typeof (cookieHeader as any)?.then === 'function' ? await cookieHeader : cookieHeader;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
        },
      },
    }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const rawUsername = body.newUsername;

  if (!rawUsername || typeof rawUsername !== 'string') {
    return NextResponse.json({ error: 'New username is required' }, { status: 400 });
  }

  const normalized = rawUsername.trim().toLowerCase();
  const usernameRegex = /^[a-z0-9._]{5,25}$/;

  if (!usernameRegex.test(normalized)) {
    return NextResponse.json({
      error: 'Username must be 5 to 25 characters and contain only lowercase letters, numbers, points (.), and underscores (_).'
    }, { status: 400 });
  }

  const cleanUsername = normalized;

  // Fetch current user profile to verify one-time change condition
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('username, username_changed_count')
    .eq('id', user.id)
    .single();

  if (profileError && profileError.code !== 'PGRST116') {
    return NextResponse.json({ error: 'Failed to verify account status' }, { status: 500 });
  }

  const changeCount = profile?.username_changed_count || 0;
  if (changeCount >= 1) {
    return NextResponse.json(
      { error: 'You have already used your one-time username modification. Your handle is permanently locked.' },
      { status: 400 }
    );
  }

  if (profile && cleanUsername.toLowerCase() === profile.username?.toLowerCase()) {
    return NextResponse.json(
      { error: 'Please enter a new username different from your current handle.' },
      { status: 400 }
    );
  }

  // Update profile with single change increment
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      username: cleanUsername,
      username_changed_count: changeCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateError) {
    if (updateError.code === '23505' || updateError.message?.toLowerCase().includes('unique') || updateError.message?.toLowerCase().includes('duplicate')) {
      return NextResponse.json(
        { error: `The username @${cleanUsername} is already taken. Please choose another.` },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: updateError.message || 'Failed to update username' }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    username: cleanUsername,
    message: `Username successfully updated to @${cleanUsername}`,
  });
}
