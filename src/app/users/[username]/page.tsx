import React from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import UserProfileClient from './UserProfileClient'

interface PageProps {
  params: Promise<{ username: string }>
}

export default async function UserProfilePage({ params }: PageProps) {
  const { username } = await params
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )

  // 1. Fetch Profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .maybeSingle()

  if (!profile) return notFound()

  // 2. Fetch Active Ads listed by this user
  const { data: ads } = await supabase
    .from('ads')
    .select('*')
    .eq('user_id', profile.id)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: false })

  // 3. Fetch Feedbacks RECEIVED by user
  const { data: receivedFeedbacks } = await supabase
    .from('feedbacks')
    .select('*, from_profile:profiles!from_user_id(username, avatar_url)')
    .eq('to_user_id', profile.id)
    .order('created_at', { ascending: false })

  // 4. Fetch Feedbacks GIVEN by user
  const { data: givenFeedbacks } = await supabase
    .from('feedbacks')
    .select('*, to_profile:profiles!to_user_id(username, avatar_url)')
    .eq('from_user_id', profile.id)
    .order('created_at', { ascending: false })

  // 5. Aggregate Trade Stats
  const { data: tradeStats } = await supabase
    .rpc('get_seller_trade_stats', { target_user_id: profile.id })
    .maybeSingle()

  return (
    <UserProfileClient
      profile={profile}
      ads={ads || []}
      receivedFeedbacks={receivedFeedbacks || []}
      givenFeedbacks={givenFeedbacks || []}
      tradeStats={{
        totalTrades: Number(tradeStats?.total_trades || profile.completed_trades || 0),
        avgReleaseSeconds: Number(tradeStats?.avg_release_seconds || 0),
        blockedBy: Number(tradeStats?.blocked_by_count || profile.blocked_by_count || 0),
        hasBlocked: Number(tradeStats?.has_blocked_count || profile.blocking_count || 0),
      }}
    />
  )
}
