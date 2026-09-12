'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import UserAvatar from '@/components/common/UserAvatar'
import { getPresenceStatus, formatJoinedDate } from '@/lib/presence'

interface UserProfileClientProps {
  profile: any
  ads: any[]
  receivedFeedbacks: any[]
  givenFeedbacks: any[]
  tradeStats: {
    totalTrades: number
    avgReleaseSeconds: number
    blockedBy: number
    hasBlocked: number
  }
}

const FIAT_COUNTRY_CODES: Record<string, string> = {
  USD: 'us',
  EUR: 'eu',
  GBP: 'gb',
  INR: 'in',
  CAD: 'ca',
  AUD: 'au',
  JPY: 'jp',
  CNY: 'cn',
  CHF: 'ch',
  HKD: 'hk',
  NZD: 'nz',
  SEK: 'se',
  KRW: 'kr',
  SGD: 'sg',
  NOK: 'no',
  MXN: 'mx',
  RUB: 'ru',
  ZAR: 'za',
  TRY: 'tr',
  BRL: 'br',
  AED: 'ae',
  PKR: 'pk',
  BDT: 'bd',
  NGN: 'ng',
  PHP: 'ph',
  IDR: 'id',
  VND: 'vn',
}

const getFiatFlagUrl = (fiat: string): string => {
  const code = FIAT_COUNTRY_CODES[fiat?.toUpperCase()] || 'us'
  return `https://flagcdn.com/w40/${code.toLowerCase()}.png`
}

export default function UserProfileClient({
  profile,
  ads,
  receivedFeedbacks,
  givenFeedbacks,
  tradeStats,
}: UserProfileClientProps) {
  const [activeTab, setActiveTab] = useState<'ads' | 'received' | 'given'>('ads')
  const presence = getPresenceStatus(profile.last_seen)

  const positiveCount = receivedFeedbacks.filter((f) => f.is_positive).length
  const negativeCount = receivedFeedbacks.filter((f) => !f.is_positive).length
  const totalCount = receivedFeedbacks.length
  const positivePercentage = totalCount > 0 ? ((positiveCount / totalCount) * 100).toFixed(0) : '100'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 text-neutral-900 dark:text-neutral-100 min-h-screen">
      {/* Header Profile Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-neutral-200 dark:border-neutral-800 gap-4">
        <div className="flex items-center space-x-4">
          <UserAvatar avatarUrl={profile.avatar_url} username={profile.username} size="xl" />
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-2xl font-bold tracking-tight">@{profile.username}</h1>
              <span className={`w-2.5 h-2.5 rounded-full ${presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'}`}></span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              {presence.label} • {formatJoinedDate(profile.created_at)}
            </p>
          </div>
        </div>
      </div>

      {/* Streamlined Stats Overview */}
      <div className="py-6 border-b border-neutral-200 dark:border-neutral-800">
        <h2 className="text-xs font-semibold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-3">
          Trader Statistics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Positive Rating</span>
            <span className="font-bold text-sm text-green-600 dark:text-green-400">{positivePercentage}% ({positiveCount})</span>
          </div>

          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Negative</span>
            <span className="font-bold text-sm text-red-600 dark:text-red-400">{negativeCount}</span>
          </div>

          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Total Trades</span>
            <span className="font-bold text-sm">{tradeStats.totalTrades}</span>
          </div>

          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Avg Release</span>
            <span className="font-bold text-sm">
              {tradeStats.avgReleaseSeconds > 0 ? `${Math.round(tradeStats.avgReleaseSeconds / 60)} min` : 'N/A'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Blocked By</span>
            <span className="font-bold text-sm">{tradeStats.blockedBy} traders</span>
          </div>

          <div className="p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <span className="text-neutral-500 dark:text-neutral-400 block">Has Blocked</span>
            <span className="font-bold text-sm">{tradeStats.hasBlocked} users</span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 my-6 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('ads')}
          className={`pb-3 transition-colors cursor-pointer ${
            activeTab === 'ads'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Active Ads ({ads.length})
        </button>
        <button
          onClick={() => setActiveTab('received')}
          className={`pb-3 transition-colors cursor-pointer ${
            activeTab === 'received'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Feedback Received ({receivedFeedbacks.length})
        </button>
        <button
          onClick={() => setActiveTab('given')}
          className={`pb-3 transition-colors cursor-pointer ${
            activeTab === 'given'
              ? 'border-b-2 border-blue-600 text-blue-600 dark:text-blue-400'
              : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Feedback Given ({givenFeedbacks.length})
        </button>
      </div>

      {/* Tab Content 1: Active Ads */}
      {activeTab === 'ads' && (
        <div className="space-y-3">
          {ads.length > 0 ? (
            ads.map((ad) => (
              <div
                key={ad.id}
                className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2.5 py-1 rounded-md text-xs font-bold ${
                      ad.type === 'BUY'
                        ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-400'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-400'
                    }`}
                  >
                    {ad.type} {ad.asset || 'BTC'}
                  </span>
                  <div className="text-xs text-neutral-500">
                    Limit: <span className="font-semibold text-neutral-800 dark:text-neutral-200">{ad.min_limit} - {ad.max_limit} {ad.fiat_currency || 'USD'}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-4">
                  <div className="text-left sm:text-right">
                    <span className="text-xs text-neutral-400 block">Unit Price</span>
                    <div className="flex items-center sm:justify-end gap-1 font-mono font-bold text-blue-600 dark:text-blue-400">
                      <img
                        src={getFiatFlagUrl(ad.fiat_currency || 'USD')}
                        alt={ad.fiat_currency || 'USD'}
                        className="w-4 h-3 object-cover rounded-xs border border-neutral-300 dark:border-neutral-700 shadow-xs"
                      />
                      <span>{parseFloat(ad.price).toLocaleString()} {ad.fiat_currency || 'USD'}</span>
                    </div>
                  </div>
                  <Link
                    href={`/ad/${ad.id}`}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-colors"
                  >
                    Trade
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-neutral-500 py-6 text-center">No active buy or sell advertisements listed by this user.</p>
          )}
        </div>
      )}

      {/* Tab Content 2: Feedbacks Received */}
      {activeTab === 'received' && (
        <div className="space-y-3">
          {receivedFeedbacks.length > 0 ? (
            receivedFeedbacks.map((fb) => (
              <div key={fb.id} className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <UserAvatar avatarUrl={fb.from_profile?.avatar_url} username={fb.from_profile?.username} size="sm" />
                    <span className="text-xs font-semibold">@{fb.from_profile?.username || 'anonymous'}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${fb.is_positive ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'}`}>
                    {fb.is_positive ? 'Positive' : 'Negative'}
                  </span>
                </div>
                <p className="text-xs text-neutral-700 dark:text-neutral-300">{fb.comment || 'No written feedback provided.'}</p>
                <span className="text-[10px] text-neutral-400 block">{new Date(fb.created_at).toLocaleDateString()}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-neutral-500 py-6 text-center">No feedback received yet.</p>
          )}
        </div>
      )}

      {/* Tab Content 3: Feedbacks Given */}
      {activeTab === 'given' && (
        <div className="space-y-3">
          {givenFeedbacks.length > 0 ? (
            givenFeedbacks.map((fb) => (
              <div key={fb.id} className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <UserAvatar avatarUrl={fb.to_profile?.avatar_url} username={fb.to_profile?.username} size="sm" />
                    <span className="text-xs font-semibold">To @{fb.to_profile?.username || 'anonymous'}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${fb.is_positive ? 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400'}`}>
                    {fb.is_positive ? 'Positive' : 'Negative'}
                  </span>
                </div>
                <p className="text-xs text-neutral-700 dark:text-neutral-300">{fb.comment || 'No written feedback provided.'}</p>
                <span className="text-[10px] text-neutral-400 block">{new Date(fb.created_at).toLocaleDateString()}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-neutral-500 py-6 text-center">No feedback given yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
