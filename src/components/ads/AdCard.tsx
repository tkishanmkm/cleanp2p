import React from 'react'
import { getPresenceStatus, formatJoinedDate } from '@/lib/presence'
import UserAvatar from '@/components/common/UserAvatar'
import Link from 'next/link'

export function AdCard({ ad }: { ad: any }) {
  const user = ad?.profiles || ad?.user || ad || {}
  const presence = getPresenceStatus(user?.last_seen || user?.last_seen_at || user?.lastActive || ad?.last_seen)
  const joinedText = formatJoinedDate(user?.created_at || user?.createdAt || ad?.created_at)
  const username = user?.username || ad?.username || 'trader'
  const avatarUrl = user?.avatar_url || user?.photoURL || ad?.avatar_url

  return (
    <div className="p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <UserAvatar avatarUrl={avatarUrl} username={username} size="sm" />
          <Link href={`/users/${username}`} className="font-semibold text-sm hover:underline">
            @{username}
          </Link>
        </div>
        
        {/* Synchronized Online / Presence Status */}
        <div className="flex items-center space-x-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          {/* Online / Offline Dot */}
          <span
            className={`w-2 h-2 rounded-full ${
              presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'
            }`}
          />
          {/* Status Label (Online or "Seen Xm ago") */}
          <span className={presence.isOnline ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
            {presence.label}
          </span>

          <span>•</span>

          {/* Dynamic Joined Date ("Joined 3 days ago", "Joined 1 month ago", etc.) */}
          <span>{joinedText}</span>
        </div>
      </div>
    </div>
  )
}

export default AdCard

