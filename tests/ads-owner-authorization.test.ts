import assert from 'node:assert/strict';
import { isAdOwner } from '../src/lib/ad-authorization';

const cases: Array<{ name: string; owner: unknown; user: unknown; expected: boolean }> = [
  { name: 'legitimate owner', owner: 'user-123', user: 'user-123', expected: true },
  { name: 'different user', owner: 'user-123', user: 'user-456', expected: false },
  { name: 'missing owner', owner: null, user: 'user-123', expected: false },
  { name: 'undefined owner', owner: undefined, user: 'user-123', expected: false },
  { name: 'blank owner', owner: '  ', user: 'user-123', expected: false },
  { name: 'missing authenticated user', owner: 'user-123', user: null, expected: false },
  { name: 'blank authenticated user', owner: 'user-123', user: ' ', expected: false },
  { name: 'non-string owner', owner: 123, user: '123', expected: false },
  { name: 'case mismatch', owner: 'User-123', user: 'user-123', expected: false },
];

for (const testCase of cases) {
  assert.equal(
    isAdOwner(testCase.owner, testCase.user),
    testCase.expected,
    testCase.name
  );
  console.log(`PASS: ${testCase.name}`);
}

console.log(`Passed ${cases.length} ad ownership unit tests.`);
