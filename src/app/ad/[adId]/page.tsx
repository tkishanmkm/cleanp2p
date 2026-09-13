import Link from 'next/link'
import AdDetailClient from './AdDetailClient'
import { getSupabaseAdminClient } from '@/lib/supabase/server'
import { findAdById } from '@/lib/ad-lookup'
import { ArrowLeft, Search, AlertCircle, ShoppingCart } from 'lucide-react'

interface PageProps {
  params: Promise<{ adId: string }>
}

export default async function AdDetailPage({ params }: PageProps) {
  const { adId } = await params
  const cleanId = (adId || '').trim()
  
  const adminClient = getSupabaseAdminClient()
  const result = await findAdById(cleanId)
  const ad = result?.ad || null

  // If ad not found, render a clean fallback UI
  if (!ad) {
    return (
      <div className="min-h-[70vh] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-500">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight mb-2">Advertisement Not Found</h1>
        <p className="text-muted-foreground text-sm max-w-md mb-8">
          The advertisement listing <span className="font-mono font-medium text-foreground bg-muted px-1.5 py-0.5 rounded">{cleanId || 'unknown'}</span> may have been completed, expired, removed by the seller, or the link is invalid.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/buy"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ShoppingCart className="w-4 h-4" />
            Browse Buy Ads
          </Link>
          <Link
            href="/sell"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-muted transition-colors"
          >
            <Search className="w-4 h-4" />
            Browse Sell Ads
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-muted-foreground text-sm font-medium hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Home
          </Link>
        </div>
      </div>
    )
  }

  // 2. Fetch Profile safely with admin fallback
  const sellerUserId = ad.user_id || ad.userId
  let advertiserProfile: any = null
  if (sellerUserId) {
    try {
      const { data: prof } = await adminClient
        .from('profiles')
        .select('*')
        .eq('id', sellerUserId)
        .maybeSingle()
      advertiserProfile = prof
    } catch (err) {
      console.warn('Error fetching profile:', err)
    }

    if (!advertiserProfile && ad.user_display_name) {
      try {
        const { data: prof } = await adminClient
          .from('profiles')
          .select('*')
          .ilike('username', ad.user_display_name)
          .maybeSingle()
        advertiserProfile = prof
      } catch {}
    }
  }

  // 3. Fetch Feedback Counts
  let positive = 0
  let negative = 0
  if (sellerUserId) {
    try {
      const { data: feedbacks } = await adminClient
        .from('feedbacks')
        .select('is_positive')
        .eq('to_user_id', sellerUserId)

      positive = feedbacks?.filter((f) => f.is_positive === true).length || 0
      negative = feedbacks?.filter((f) => f.is_positive === false).length || 0
    } catch (err) {
      console.warn('Error fetching feedbacks:', err)
    }
  }

  // 4. Fetch Advanced Seller Trade Stats safely with fallback
  let tradeStats: any = null
  if (sellerUserId) {
    try {
      const { data: rpcStats } = await adminClient
        .rpc('get_seller_trade_stats', { target_user_id: sellerUserId })
        .single()
      tradeStats = rpcStats
    } catch (err) {
      console.warn('RPC get_seller_trade_stats fallback:', err)
    }
  }

  // Normalize ad fields for client component
  const normalizedAd = {
    ...ad,
    id: ad.id || cleanId,
    public_ad_id: ad.public_ad_id || ad.public_id || ad.ad_id || ad.id || cleanId,
    asset_symbol: (ad.asset_symbol || ad.asset || ad.crypto || ad.crypto_symbol || ad.coin || 'BTC').toUpperCase(),
    fiat_symbol: (ad.fiat_symbol || ad.fiat_currency || ad.fiat || ad.currency || 'USD').toUpperCase(),
    price: Number(ad.price ?? ad.unit_price ?? ad.fixed_rate ?? 0),
    min_limit: Number(ad.min_limit ?? ad.min_amount ?? ad.minAmount ?? 0),
    max_limit: Number(ad.max_limit ?? ad.max_amount ?? ad.maxAmount ?? ad.total_amount ?? 99999999),
    payment_methods: Array.isArray(ad.payment_methods)
      ? ad.payment_methods
      : (Array.isArray(ad.paymentMethods) ? ad.paymentMethods : ['Bank Transfer']),
    type: String(ad.type || ad.side || ad.ad_type || ad.adType || 'SELL').toUpperCase(),
  }

  return (
    <AdDetailClient
      ad={normalizedAd}
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
