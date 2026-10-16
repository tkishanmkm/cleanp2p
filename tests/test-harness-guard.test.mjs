import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const suites = [
  ['tests/p2p-trade-flow.test.ts', 'TEST_ALLOW_DESTRUCTIVE_P2P_TESTS'],
  ['tests/blockchain-worker.test.ts', 'TEST_ALLOW_DESTRUCTIVE_BLOCKCHAIN_TESTS'],
  ['tests/reconciliation.test.ts', 'TEST_ALLOW_DESTRUCTIVE_RECONCILIATION_TESTS'],
  ['tests/security-verification.test.ts', 'TEST_ALLOW_DESTRUCTIVE_SECURITY_TESTS'],
];

for (const [path, optIn] of suites) {
  const source = readFileSync(path, 'utf8');
  assert.ok(source.includes('process.env.TEST_SUPABASE_URL'), path + ': dedicated test URL required');
  assert.ok(source.includes('process.env.TEST_SUPABASE_SERVICE_ROLE_KEY'), path + ': dedicated test service key required');
  assert.ok(source.includes("process.env." + optIn + " !== 'true'"), path + ': explicit destructive-test opt-in required');
  assert.match(source, /https.*supabase.*co.*i/, path + ': Supabase URL validation required');
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY\s*\|\||NEXT_PUBLIC_SUPABASE_ANON_KEY|placeholder\.supabase\.co/, path + ': application/placeholder credential fallback forbidden');
}
const securitySuite = readFileSync('tests/security-verification.test.ts', 'utf8');
assert.ok(securitySuite.includes('process.env.TEST_APP_URL'), 'security suite must require explicit test app URL');
console.log('Test harness guards passed for all four destructive integration suites.');
