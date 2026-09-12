import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import AdDetailClient from './AdDetailClient'

interface PageProps {
  params: Promise<{ adId: string }>
}

export default async function AdDetailPage({ params }: PageProps) {
  const { adId } = await params
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
      },
    }
  )

  // 1. Fetch Ad
  let { data: ad } = await supabase
    .from('ads')
    .select('*')
    .eq('id', adId)
    .maybeSingle()

  if (!ad) {
    const { data: p2pAd } = await supabase
      .from('p2p_ads')
      .select('*')
      .eq('id', adId)
      .maybeSingle()
    ad = p2pAd
  }

  if (!ad) return notFound()

  // 2. Fetch Profile
  const { data: advertiserProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', ad.user_id)
    .maybeSingle()

  // 3. Fetch Feedback Counts
  const { data: feedbacks } = await supabase
    .from('feedbacks')
    .select('is_positive')
    .eq('to_user_id', ad.user_id)

  const positive = feedbacks?.filter((f) => f.is_positive === true).length || 0
  const negative = feedbacks?.filter((f) => f.is_positive === false).length || 0

  // 4. Fetch Advanced Seller Trade Stats safely with fallback
  let tradeStats: any = null
  try {
    const { data: rpcStats } = await supabase
      .rpc('get_seller_trade_stats', { target_user_id: ad.user_id })
      .single()
    tradeStats = rpcStats
  } catch (err) {
    console.warn('RPC get_seller_trade_stats fallback:', err)
  }

  return (
    <AdDetailClient
      ad={ad}
      advertiser={advertiserProfile}
      stats={{
        positiveFeedbacks: positive,
        negativeFeedbacks: negative,
        totalTrades: Number(tradeStats?.total_trades || advertiserProfile?.completed_trades || 0),
        avgPaySeconds: Number(tradeStats?.avg_pay_seconds || (advertiserProfile?.avg_pay_minutes ? advertiserProfile.avg_pay_minutes * 60 : 0)),
        avgReleaseSeconds: Number(tradeStats?.avg_release_seconds || (advertiserProfile?.avg_release_minutes ? advertiserProfile.avg_release_minutes * 60 : 0)),
        blockedBy: Number(tradeStats?.blocked_by_count || advertiserProfile?.blocked_by_count || 0),
        hasBlocked: Number(tradeStats?.has_blocked_count || advertiserProfile?.blocking_count || 0),
      }}
    />
  )
}
