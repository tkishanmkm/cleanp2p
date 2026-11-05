/**
 * Persistent client retry-key storage for withdrawal intents.
 * Only a SHA-256 digest of the intent is used as the storage key; destination
 * addresses, amounts, and other intent details are not written to storage.
 */
const PREFIX = 'paxones:pending-withdrawal:v1:';

type PendingRecord = { key: string; createdAt: number };

function storageOrThrow(): Storage {
  if (typeof window === 'undefined') {
    throw new Error('Withdrawal retry state is unavailable outside the browser.');
  }
  try {
    const storage = window.localStorage;
    const probe = `${PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    throw new Error('Browser storage is unavailable. No withdrawal was submitted.');
  }
}

async function intentHash(userId: string, fingerprint: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([userId, fingerprint]));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readRecord(storage: Storage, storageKey: string): PendingRecord | null {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingRecord>;
    if (typeof value.key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value.key)) return null;
    if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return null;
    return { key: value.key, createdAt: value.createdAt };
  } catch {
    return null;
  }
}

export async function getOrCreatePendingWithdrawalKeyDetails(
  userId: string,
  fingerprint: string,
): Promise<{ key: string; reused: boolean }> {
  if (!userId || !fingerprint) throw new Error('Withdrawal intent is required.');
  const storage = storageOrThrow();
  const hash = await intentHash(userId, fingerprint);
  const storageKey = `${PREFIX}${hash}`;

  const getOrCreate = (): { key: string; reused: boolean } => {
    const existing = readRecord(storage, storageKey);
    if (existing) return { key: existing.key, reused: true };

    const key = globalThis.crypto.randomUUID();
    const record: PendingRecord = { key, createdAt: Date.now() };
    try {
      storage.setItem(storageKey, JSON.stringify(record));
      if (readRecord(storage, storageKey)?.key !== key) {
        throw new Error('Stored retry key did not verify.');
      }
    } catch {
      throw new Error('Unable to persist withdrawal retry state. No withdrawal was submitted.');
    }
    return { key, reused: false };
  };

  try {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request(`paxones-withdrawal-key:${hash}`, getOrCreate);
    }
    // Server-side idempotency remains authoritative where Web Locks are unavailable.
    return getOrCreate();
  } catch (error) {
    if (error instanceof Error && /withdrawal retry state|retry key|intent is required/.test(error.message)) throw error;
    throw new Error('Unable to prepare a safe withdrawal retry key.');
  }
}

export async function getOrCreatePendingWithdrawalKey(
  userId: string,
  fingerprint: string,
): Promise<string> {
  return (await getOrCreatePendingWithdrawalKeyDetails(userId, fingerprint)).key;
}

/** Clear only after a definitive successful response from the withdrawal API. */
export async function clearPendingWithdrawalKey(
  userId: string,
  fingerprint: string,
  expectedKey: string,
): Promise<void> {
  if (!userId || !fingerprint || !expectedKey || typeof window === 'undefined') return;
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const hash = await intentHash(userId, fingerprint);
  const storageKey = `${PREFIX}${hash}`;
  const clear = () => {
    try {
      if (readRecord(storage, storageKey)?.key === expectedKey) storage.removeItem(storageKey);
    } catch {
      // Retain the key if cleanup fails; reuse is safer than generating a new key.
    }
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    await navigator.locks.request(`paxones-withdrawal-key:${hash}`, clear);
  } else {
    clear();
  }
}
