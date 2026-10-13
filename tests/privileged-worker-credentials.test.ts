import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ingestion = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
const confirmations = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');

for (const [name, source] of [['deposit ingestion', ingestion], ['confirmation worker', confirmations]] as const) {
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /missing-service-role-key/);
  assert.match(source, /https:\/\/placeholder\.supabase\.co/);
}

console.log('privileged worker credential fallback assertions passed (8 assertions)');
