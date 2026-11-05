import { createClient } from '@/utils/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const targetId = request.nextUrl.searchParams.get('targetId');
  const admin = getSupabaseAdminClient();
  const mode = request.nextUrl.searchParams.get('mode');

  if (mode === 'list' || mode === 'search') {
    if (mode === 'list') {
      const { data: ownProfile, error: ownError } = await admin
        .from('profiles').select('blocked_users').eq('id', user.id).maybeSingle();
      if (ownError) return NextResponse.json({ error: 'Unable to load blocked users' }, { status: 500 });
      const ids: string[] = Array.isArray(ownProfile?.blocked_users)
        ? ownProfile.blocked_users.filter((id: unknown): id is string => typeof id === 'string').slice(0, 200)
        : [];
      if (!ids.length) return NextResponse.json({ users: [] });
      const { data, error } = await admin.from('public_profiles')
        .select('id, username, photo_url').in('id', ids);
      if (error) return NextResponse.json({ error: 'Unable to load blocked users' }, { status: 500 });
      return NextResponse.json({ users: data || [] });
    }

    const query = (request.nextUrl.searchParams.get('q') || '').trim().replace(/^@/, '').slice(0, 64);
    if (query.length < 2) return NextResponse.json({ users: [] });
    const { data: ownProfile, error: ownError } = await admin
      .from('profiles').select('blocked_users').eq('id', user.id).maybeSingle();
    if (ownError) return NextResponse.json({ error: 'Unable to search users' }, { status: 500 });
    const blockedIds: string[] = Array.isArray(ownProfile?.blocked_users) ? ownProfile.blocked_users : [];
    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    const { data, error } = await admin.from('public_profiles')
      .select('id, username, photo_url')
      .ilike('username', `%${escapedQuery}%`)
      .neq('id', user.id)
      .limit(5);
    if (error) return NextResponse.json({ error: 'Unable to search users' }, { status: 500 });
    return NextResponse.json({ users: (data || []).filter((profile: any) => !blockedIds.includes(profile.id)) });
  }

  if (!targetId) {
    return NextResponse.json({ status: 'NOT_BLOCKED', isBlockedByMe: false, blockedByCount: 0, usersBlockedCount: 0 });
  }

  try {
    // 1. Fetch blocker & target profile
    const isTargetUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
    let profileQuery = admin
      .from('profiles')
      .select('id, username, blocked_users');

    if (isTargetUuid) {
      profileQuery = profileQuery.or(`id.eq.${user.id},id.eq.${targetId},username.eq.${targetId}`);
    } else {
      profileQuery = profileQuery.or(`id.eq.${user.id},username.eq.${targetId}`);
    }

    const { data: profiles } = await profileQuery;

    const myProfile = profiles?.find((p) => p.id === user.id);
    const targetProfile = profiles?.find((p) => p.id === targetId || p.username === targetId);

    const targetRealId = targetProfile?.id || targetId;

    const myBlocked: string[] = Array.isArray(myProfile?.blocked_users) ? myProfile.blocked_users : [];
    const targetBlocked: string[] = Array.isArray(targetProfile?.blocked_users) ? targetProfile.blocked_users : [];

    // Check user_blocks table too
    let youBlockedThem = myBlocked.includes(targetRealId) || (targetProfile?.username ? myBlocked.includes(targetProfile.username) : false);
    let theyBlockedYou = targetBlocked.includes(user.id) || (myProfile?.username ? targetBlocked.includes(myProfile.username) : false);

    try {
      const { data: blocks } = await admin
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${targetRealId}),and(blocker_id.eq.${targetRealId},blocked_id.eq.${user.id})`);

      if (blocks?.some((b) => b.blocker_id === user.id && b.blocked_id === targetRealId)) {
        youBlockedThem = true;
      }
      if (blocks?.some((b) => b.blocker_id === targetRealId && b.blocked_id === user.id)) {
        theyBlockedYou = true;
      }
    } catch {
      // ignore
    }

    let status = 'NOT_BLOCKED';
    if (youBlockedThem && theyBlockedYou) {
      status = 'BLOCKED_BOTH_WAYS';
    } else if (youBlockedThem) {
      status = 'YOU_BLOCKED_THIS_USER';
    } else if (theyBlockedYou) {
      status = 'THIS_USER_BLOCKED_YOU';
    }

    // Count relationships from the normalized block table. Never scan every profile
    // row (or retrieve other users' private blocked_users arrays) for this response.
    let blockedByCount = 0;
    let usersBlockedCount = 0;
    try {
      const { data: incomingBlocks, error: incomingError } = await admin
        .from('user_blocks')
        .select('blocker_id')
        .eq('blocked_id', targetRealId);

      if (!incomingError && Array.isArray(incomingBlocks)) {
        blockedByCount = new Set(incomingBlocks.map((block) => block.blocker_id)).size;
      }

      const { data: outgoingBlocks, error: outgoingError } = await admin
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', targetRealId);

      if (!outgoingError && Array.isArray(outgoingBlocks)) {
        usersBlockedCount = new Set(outgoingBlocks.map((block) => block.blocked_id)).size;
      }
    } catch {
      // Keep counts at zero if the normalized relationship table is unavailable.
    }

    return NextResponse.json({
      status,
      isBlockedByMe: youBlockedThem,
      theyBlockedYou,
      blockedByCount,
      usersBlockedCount,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: 'NOT_BLOCKED',
      isBlockedByMe: false,
      blockedByCount: 0,
      usersBlockedCount: 0,
      error: err?.message,
    });
  }
}
