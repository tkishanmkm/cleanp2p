'use client'

import React from 'react'

interface UserAvatarProps {
  avatarUrl?: string | null
  username?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export default function UserAvatar({ avatarUrl, username, size = 'md', className = '' }: UserAvatarProps) {
  const sizeClasses = {
    sm: 'w-7 h-7',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
    xl: 'w-20 h-20',
  }

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={username || 'User Avatar'}
        className={`${sizeClasses[size]} rounded-full object-cover border border-neutral-200 dark:border-neutral-700 ${className}`}
      />
    )
  }

  // Fallback matching avatar asset
  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-neutral-300 dark:bg-neutral-700 flex items-center justify-center overflow-hidden border border-neutral-200 dark:border-neutral-700 shrink-0 ${className}`}
    >
      <svg
        className="w-full h-full text-neutral-100 dark:text-neutral-400 translate-y-1"
        fill="currentColor"
        viewBox="0 0 24 24"
      >
        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
    </div>
  )
}
