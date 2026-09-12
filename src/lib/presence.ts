// Calculates online status with a 120-second threshold
export function getPresenceStatus(lastSeen: string | Date | null | undefined) {
  if (!lastSeen) return { isOnline: false, label: 'Offline' }
  
  const lastSeenDate = new Date(lastSeen)
  const diffInSeconds = Math.floor((Date.now() - lastSeenDate.getTime()) / 1000)

  if (diffInSeconds < 120) {
    return { isOnline: true, label: 'Online' }
  }

  if (diffInSeconds < 3600) {
    const mins = Math.floor(diffInSeconds / 60)
    return { isOnline: false, label: `Last seen ${mins}m ago` }
  }

  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return { isOnline: false, label: `Last seen ${hours}h ago` }
  }

  const days = Math.floor(diffInSeconds / 86400)
  return { isOnline: false, label: `Last seen ${days}d ago` }
}

// Relative join date formatter
export function formatJoinedDate(createdAt: string | Date | null | undefined): string {
  if (!createdAt) return 'Joined recently'
  
  const created = new Date(createdAt)
  const diffInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 3600 * 24))

  if (diffInDays < 1) return 'Joined today'
  if (diffInDays === 1) return 'Joined 1 day ago'
  if (diffInDays < 30) return `Joined ${diffInDays} days ago`
  
  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) {
    return `Joined ${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`
  }

  const diffInYears = Math.floor(diffInDays / 365)
  return `Joined ${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`
}
