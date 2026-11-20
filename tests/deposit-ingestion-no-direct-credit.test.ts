import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ingestion = readFileSync('src/jobs/depositIngestion.ts', 'utf8');

test('deposit ingestion never submits scanner-supplied confirmation counts to the credit RPC', () => {
  assert.doesNotMatch(ingestion, /p_confirmations:\s*(?:confirmations|confs)\s*,/);
  assert.equal((ingestion.match(/p_confirmations:\s*0\s*,/g) || []).length, 8);
});

test('deposit ingestion requires the configured service-role client without an anon or placeholder fallback', () => {
  assert.match(ingestion, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(ingestion, /import\s*\{\s*supabaseService as serviceRoleClient\s*\}/);
  assert.doesNotMatch(ingestion, /NEXT_PUBLIC_SUPABASE_ANON_KEY|placeholder-key|eaiwgfxoiwxepinvcykg\.supabase\.co/);
  assert.match(ingestion, /supabaseUrl && supabaseKey \? serviceRoleClient : null/);
  assert.match(ingestion, /if \(!supabaseAdmin\)/);
});

test('every scanner registration response is classified and rejected candidates become visible errors', () => {
  assert.equal((ingestion.match(/recordPendingDepositRegistration\(/g) || []).length, 9);
  assert.match(ingestion, /if \(result\.success !== true\)/);
  assert.match(ingestion, /const isPending = status === 'PENDING'/);
  assert.match(ingestion, /const isReplay = status === 'ALREADY_CREDITED'/);
  assert.match(ingestion, /result\.credited === true/);
  assert.match(ingestion, /result\.already_credited === true/);
  assert.match(ingestion, /Pending deposit candidate rejected/);
  assert.match(ingestion, /unexpected status on/);
});

test('canonical worker reports collected deposit ingestion and registration errors', () => {
  assert.match(ingestion, /const result = await runDepositIngestion\(\)/);
  assert.match(ingestion, /result\.results\.flatMap/);
  assert.match(ingestion, /Deposit Ingestion\] Scan\/registration errors reported/);
  assert.match(ingestion, /reportedErrors\.slice\(0, 50\)/);
});
