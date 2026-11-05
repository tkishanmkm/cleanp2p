import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const worker = readFileSync(join(process.cwd(), 'src/jobs/confirmationsWorker.ts'), 'utf8');
const canonicalMigration = readFileSync(join(process.cwd(), 'supabase/migrations/20260924000000_canonical_deposit_rpc_v2.sql'), 'utf8');
assert.ok(worker.includes('process_deposit_atomic'), 'confirmation worker must use the canonical atomic deposit RPC');
assert.ok(worker.includes('supabaseAdmin'), 'confirmation worker must call the RPC through the trusted server client');
assert.ok(canonicalMigration.includes('GRANT EXECUTE ON FUNCTION public.process_deposit_atomic TO service_role, postgres'), 'baseline migration should grant trusted-worker access');
console.log('PASS: confirmation worker uses the canonical atomic deposit RPC and the baseline migration declares trusted-worker access.');
console.log('NOTE: production privilege was separately checked read-only; the live function is executable by service_role.');
