/**
 * Formats display name strictly for the Trade Chat Info ("i" Icon)
 */
export function getTradeChatDisplayName(user?: {
  full_name?: string | null;
  username?: string | null;
  name_privacy?: string | null;
} | null): string {
  if (!user) return '';
  const { full_name, username, name_privacy } = user;

  if (name_privacy === 'full_name' && full_name?.trim()) {
    return full_name.trim();
  }

  if (name_privacy === 'partial_name' && full_name?.trim()) {
    const parts = full_name.trim().split(/\s+/);
    const initial = parts[0].charAt(0).toUpperCase();
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    return lastName ? `${initial}. ${lastName}` : `${initial}.`;
  }

  // Fallback for 'hide_name' or missing full_name
  return username ? `@${username}` : '';
}

/**
 * Returns strictly the username for everywhere else on the platform
 */
export function getPublicHandle(username?: string | null): string {
  return username ? `@${username}` : '';
}
