'use client'

import React, { useState, useEffect } from 'react'

interface UserAvatarProps {
  userId?: string | null
  avatarUrl?: string | null
  photoUrl?: string | null
  photoURL?: string | null
  username?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  className?: string
  alt?: string
}

export default function UserAvatar({
  userId,
  avatarUrl,
  photoUrl,
  photoURL,
  username,
  size = 'md',
  className = '',
  alt,
}: UserAvatarProps) {
  const [hasError, setHasError] = useState(false)

  const sizeClasses = {
    xs: 'w-5 h-5 text-[9px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-14 h-14 text-base',
    xl: 'w-20 h-20 text-xl',
    '2xl': 'w-24 h-24 text-2xl',
  }

  // Sanitize candidate sources
  const cleanAvatarUrl = avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim() !== '' ? avatarUrl.trim() : null
  const cleanPhotoUrl = photoUrl && typeof photoUrl === 'string' && photoUrl.trim() !== '' ? photoUrl.trim() : null
  const cleanPhotoURL = photoURL && typeof photoURL === 'string' && photoURL.trim() !== '' ? photoURL.trim() : null
  const cleanUserId = userId && typeof userId === 'string' && userId.trim() !== '' ? userId.trim() : null

  // Resolve best source
  const src = cleanAvatarUrl || cleanPhotoUrl || cleanPhotoURL || (cleanUserId ? `/api/media/avatar/${cleanUserId}` : null)

  useEffect(() => {
    setHasError(false)
  }, [src])

  const initials = username && typeof username === 'string' && username.trim() !== ''
    ? username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'PX'
    : 'PX'

  if (src && !hasError) {
    return (
      <img
        src={src}
        alt={alt || username || 'User Avatar'}
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className={`${sizeClasses[size]} rounded-full object-cover border border-neutral-200 dark:border-neutral-700 shrink-0 ${className}`}
      />
    )
  }

  // Fallback avatar with clean initials
  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center overflow-hidden border border-neutral-200 dark:border-neutral-700 shrink-0 select-none ${className}`}
    >
      <span>{initials}</span>
    </div>
  )
}

