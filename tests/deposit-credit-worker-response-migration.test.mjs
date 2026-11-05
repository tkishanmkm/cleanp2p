import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261101110000_align_deposit_credit_worker_rpc_response.sql',
  'utf8',
);
const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');

test('deposit response migration targets only the canonical deployed function signature', () => {
  assert.match(migration, /to_regprocedure\([\s\S]*public\.process_deposit_atomic\(text,text,text,numeric,text,integer,bigint,text,text,integer,text\)/);
  assert.match(migration, /pg_get_functiondef\(v_oid\)/);
  assert.match(migration, /EXECUTE v_definition/);
  assert.match(migration, /Expected one ALREADY_CREDITED and one CONFIRMED success response/);
});

test('new credit and idempotent replay have mutually exclusive explicit response flags', () => {
  assert.match(migration, /''credited'', false/);
  assert.match(migration, /''already_credited'', true/);
  assert.match(migration, /''credited'', true/);
  assert.match(migration, /''already_credited'', false/);
  assert.match(migration, /ALREADY_CREDITED response contract validation failed/);
  assert.match(migration, /CONFIRMED response contract validation failed/);
});

test('worker accepts only confirmed credit or verified prior-credit replay', () => {
  assert.match(worker, /parsedRes\?\.status === 'CONFIRMED'/);
  assert.match(worker, /parsedRes\?\.credited === true/);
  assert.match(worker, /parsedRes\?\.already_credited === false/);
  assert.match(worker, /parsedRes\?\.status === 'ALREADY_CREDITED'/);
  assert.match(worker, /parsedRes\?\.credited === false/);
  assert.match(worker, /parsedRes\?\.already_credited === true/);
  assert.doesNotMatch(worker, /parsedRes\?\.code\s*===\s*['"](?:DEPOSIT_CREDITED|ALREADY_PROCESSED)['"]/);
});
