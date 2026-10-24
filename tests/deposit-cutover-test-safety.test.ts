import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tests/canonical-deposit-cutover.test.ts', 'utf8');
assert.match(source, /ALLOW_DESTRUCTIVE_DEPOSIT_CUTOVER_TESTS !== 'true'/);
assert.match(source, /SUPABASE_TEST_URL/);
assert.match(source, /SUPABASE_TEST_SERVICE_ROLE_KEY/);
assert.match(source, /Refusing to run destructive deposit cutover tests/);
assert.match(source, /!\['localhost', '127\.0\.0\.1', '::1'\]\.includes\(testHost\)/);
assert.doesNotMatch(source, /loadDotenv\(\{ path: '\.env\.local' \}\)/);
assert.doesNotMatch(source, /process\.env\.SUPABASE_SERVICE_ROLE_KEY \|\| process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);

console.log('deposit cutover test safety assertions passed (7 assertions)');
