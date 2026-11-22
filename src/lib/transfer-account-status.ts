const BLOCKED_TRANSFER_STATUSES = new Set([
  'BANNED',
  'RESTRICTED',
  'SUSPENDED',
  'FROZEN',
  'DELETION_PENDING',
  'DELETED',
  'CLOSED',
  'INACTIVE',
]);

export interface TransferAccountStatus {
  is_banned?: boolean | null;
  is_restricted?: boolean | null;
  is_suspended?: boolean | null;
  is_minor_restricted?: boolean | null;
  is_emergency_frozen?: boolean | null;
  account_status?: string | null;
  status?: string | null;
}

/** Fail closed for explicit restriction flags and any non-active account_status. */
export function isTransferAccountBlocked(profile: TransferAccountStatus): boolean {
  const accountStatus = String(profile.account_status ?? '').trim().toUpperCase();
  const profileStatus = String(profile.status ?? '').trim().toUpperCase();

  return Boolean(
    profile.is_banned ||
    profile.is_restricted ||
    profile.is_suspended ||
    profile.is_minor_restricted ||
    profile.is_emergency_frozen ||
    (accountStatus !== '' && accountStatus !== 'ACTIVE') ||
    BLOCKED_TRANSFER_STATUSES.has(profileStatus)
  );
}
