import React from 'react'
import { getPresenceStatus } from '@/lib/presence'
import UserAvatar from '@/components/common/UserAvatar'
import Link from 'next/link'

export function AdCard({ ad }: { ad: any }) {
  const presence = getPresenceStatus(ad.profiles?.last_seen || ad.user?.last_seen || ad.last_seen)
  const username = ad.profiles?.username || ad.user?.username || 'trader'
  const avatarUrl = ad.profiles?.avatar_url || ad.user?.avatar_url

  return (
    <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="flex items-center space-x-2">
        <UserAvatar avatarUrl={avatarUrl} username={username} size="sm" />
        <Link href={`/users/${username}`} className="font-semibold text-sm hover:underline">
          @{username}
        </Link>
        
        {/* Synchronized Online Badge */}
        <span className="flex items-center space-x-1 text-xs">
          <span className={`w-2 h-2 rounded-full ${presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'}`}></span>
          <span className="text-neutral-500">{presence.label}</span>
        </span>
      </div>
    </div>
  )
}

export default AdCard
