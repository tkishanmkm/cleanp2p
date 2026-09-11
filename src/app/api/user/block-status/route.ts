import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/utils/supabase/server';

export async function GET(request: NextRequest) {
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

  const { data: { user } } = await supabase.auth.getUser();
  const targetId = request.nextUrl.searchParams.get('targetId');

  if (!user || !targetId) {
    return NextResponse.json({ status: 'NOT_BLOCKED', isBlockedByMe: false, blockedByCount: 0, usersBlockedCount: 0 });
  }

  const admin = getSupabaseAdminClient();

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

    // Calculate how many distinct users have blocked this target user
    let blockedByCount = 0;
    try {
      const { data: allProfiles } = await admin
        .from('profiles')
        .select('id, blocked_users');

      if (allProfiles) {
        for (const p of allProfiles) {
          if (p.id === targetRealId) continue;
          const blk: string[] = Array.isArray(p.blocked_users) ? p.blocked_users : [];
          if (blk.includes(targetRealId) || (targetProfile?.username && blk.includes(targetProfile.username))) {
            blockedByCount++;
          }
        }
      }
    } catch {
      // ignore
    }

    const usersBlockedCount = Array.from(new Set(targetBlocked)).length;

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
