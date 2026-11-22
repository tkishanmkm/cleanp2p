export interface DepositAddressOwnerRow {
  user_id: string | null;
  address: string | null;
}

export interface NormalizedDepositAddress {
  value: string;
  caseInsensitive: boolean;
}

export class DepositAddressOwnershipConflictError extends Error {
  readonly code = 'DEPOSIT_ADDRESS_OWNER_CONFLICT';

  constructor() {
    super('The address is associated with more than one account. Support review is required.');
    this.name = 'DepositAddressOwnershipConflictError';
  }
}

/**
 * Accept only address-shaped input. Base58/Bech32-style addresses are compared
 * exactly; EVM addresses are compared case-insensitively.
 */
export function normalizeDepositAddressForLookup(
  input: unknown
): NormalizedDepositAddress | null {
  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (value.length > 128) return null;

  if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return { value: value.toLowerCase(), caseInsensitive: true };
  }

  if (/^[A-Za-z0-9]{20,128}$/.test(value)) {
    return { value, caseInsensitive: false };
  }

  return null;
}

/**
 * Combines candidate ownership rows from both address registries.
 * Returns null only when no exact address match exists; ambiguous ownership
 * fails closed instead of selecting an arbitrary account.
 */
export function resolveDepositAddressOwnerFromRows(
  input: unknown,
  rows: readonly DepositAddressOwnerRow[]
): string | null {
  const normalized = normalizeDepositAddressForLookup(input);
  if (!normalized) return null;

  const owners = new Set<string>();

  for (const row of rows) {
    if (typeof row.address !== 'string' || typeof row.user_id !== 'string' || !row.user_id) {
      continue;
    }

    const stored = row.address.trim();
    const matches = normalized.caseInsensitive
      ? stored.toLowerCase() === normalized.value
      : stored === normalized.value;

    if (matches) owners.add(row.user_id);
  }

  if (owners.size > 1) {
    throw new DepositAddressOwnershipConflictError();
  }

  return owners.values().next().value ?? null;
}
