/**
 * Fail-closed ad ownership check for routes that perform privileged writes.
 * Only a non-empty authenticated user ID exactly matching a non-empty owner ID is accepted.
 */
export function isAdOwner(ownerId: unknown, authenticatedUserId: unknown): boolean {
  if (typeof ownerId !== 'string' || !ownerId.trim()) return false;
  if (typeof authenticatedUserId !== 'string' || !authenticatedUserId.trim()) return false;
  return ownerId === authenticatedUserId;
}
