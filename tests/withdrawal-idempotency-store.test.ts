import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPendingWithdrawalKey, getOrCreatePendingWithdrawalKey } from '../src/lib/withdrawal-idempotency-store';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  keys() { return [...this.values.keys()]; }
}

function installBrowserStorage() {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });
  return storage;
}

test('same user and intent reuse the same persisted key across helper calls', async () => {
  installBrowserStorage();
  const first = await getOrCreatePendingWithdrawalKey('user-a', 'intent-a');
  const second = await getOrCreatePendingWithdrawalKey('user-a', 'intent-a');
  assert.equal(first, second);
});

test('different users or changed intent get different keys', async () => {
  installBrowserStorage();
  const first = await getOrCreatePendingWithdrawalKey('user-a', 'intent-a');
  const otherUser = await getOrCreatePendingWithdrawalKey('user-b', 'intent-a');
  const changedIntent = await getOrCreatePendingWithdrawalKey('user-a', 'intent-b');
  assert.notEqual(first, otherUser);
  assert.notEqual(first, changedIntent);
});

test('storage key does not contain the raw intent or user identifier', async () => {
  const storage = installBrowserStorage();
  await getOrCreatePendingWithdrawalKey('private-user-id', 'sensitive-destination-and-amount');
  const keys = storage.keys();
  assert.equal(keys.length, 1);
  assert.doesNotMatch(keys[0], /private-user-id|sensitive-destination-and-amount/);
});

test('clear removes only the matching expected key', async () => {
  installBrowserStorage();
  const first = await getOrCreatePendingWithdrawalKey('user-a', 'intent-a');
  await clearPendingWithdrawalKey('user-a', 'intent-a', 'different-key-value');
  assert.equal(await getOrCreatePendingWithdrawalKey('user-a', 'intent-a'), first);
  await clearPendingWithdrawalKey('user-a', 'intent-a', first);
  assert.notEqual(await getOrCreatePendingWithdrawalKey('user-a', 'intent-a'), first);
});

test('missing browser storage fails closed instead of generating an unpersisted key', async () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  await assert.rejects(
    getOrCreatePendingWithdrawalKey('user-a', 'intent-a'),
    /unavailable outside the browser/,
  );
});
