import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ingestion = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
const serviceRole = readFileSync('src/lib/supabase/service-role.ts', 'utf8');

test('deposit ingestion never submits scanner-supplied confirmation counts to the credit RPC', () => {
  assert.doesNotMatch(ingestion, /p_confirmations:\s*(?:confirmations|confs)\s*,/);
  assert.equal((ingestion.match(/p_confirmations:\s*0\s*,/g) || []).length, 8);
});

test('deposit ingestion requires configured service-role credentials and has no anon or placeholder fallback', () => {
  assert.match(ingestion, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ingestion, /NEXT_PUBLIC_SUPABASE_ANON_KEY|placeholder-key|eaiwgfxoiwxepinvcykg\.supabase\.co/);
  assert.match(ingestion, /supabaseUrl && supabaseKey \? serviceRoleClient : null/);
  assert.match(ingestion, /if \(!supabaseAdmin\)/);
  assert.match(serviceRole, /serviceKey\.length >= 20/);
  assert.match(serviceRole, /serviceKey !== anonKey/);
});
