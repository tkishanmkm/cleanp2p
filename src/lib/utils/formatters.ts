export function formatMemberDuration(createdAt: string | Date): string {
  const start = new Date(createdAt);
  const now = new Date();
  
  const diffTime = Math.abs(now.getTime() - start.getTime());
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 1) return 'Joined today';
  if (diffDays === 1) return 'Joined 1 day ago';
  if (diffDays < 30) return `Joined ${diffDays} days ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths === 1) return 'Joined 1 month ago';
  if (diffMonths < 12) return `Joined ${diffMonths} months ago`;

  const diffYears = Math.floor(diffDays / 365);
  if (diffYears <= 1) return 'Joined 1 year ago';
  return `Joined ${diffYears} years ago`;
}

export function isUserOnline(lastSeenAt?: string | null, thresholdMinutes = 5): boolean {
  if (!lastSeenAt) return false;
  const lastSeen = new Date(lastSeenAt).getTime();
  const now = new Date().getTime();
  return now - lastSeen < thresholdMinutes * 60 * 1000;
}
