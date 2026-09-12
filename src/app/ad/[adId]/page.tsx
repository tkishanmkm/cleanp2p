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

  // 1. Fetch Ad safely handling both UUID and alphanumeric public IDs
  const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(adId)
  let ad: any = null

  try {
    let adQuery = supabase.from('ads').select('*')
    if (isUuid) {
      adQuery = adQuery.eq('id', adId)
    } else {
      adQuery = adQuery.or(`public_id.eq.${adId},ad_id.eq.${adId}`)
    }
    const { data: foundAd } = await adQuery.maybeSingle()
    ad = foundAd
  } catch (err) {
    console.warn('Error fetching from ads table:', err)
  }

  if (!ad) {
    try {
      let p2pQuery = supabase.from('p2p_ads').select('*')
      if (isUuid) {
        p2pQuery = p2pQuery.eq('id', adId)
      } else {
        p2pQuery = p2pQuery.or(`public_id.eq.${adId},public_ad_id.eq.${adId},id.eq.${adId}`)
      }
      const { data: p2pAd } = await p2pQuery.maybeSingle()
      ad = p2pAd
    } catch (err) {
      console.warn('Error fetching from p2p_ads table:', err)
    }
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
