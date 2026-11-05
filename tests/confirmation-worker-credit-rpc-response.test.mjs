import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20261101110000_align_deposit_credit_worker_rpc_response.sql', 'utf8');

test('confirmation worker requires explicit confirmed-credit and replay flags', () => {
  assert.ok(worker.includes('parsedRes?.success === true'));
  assert.ok(worker.includes("parsedRes?.status === 'CONFIRMED'"));
  assert.ok(worker.includes('parsedRes?.credited === true'));
  assert.ok(worker.includes('parsedRes?.already_credited === false'));
  assert.ok(worker.includes("parsedRes?.status === 'ALREADY_CREDITED'"));
  assert.ok(worker.includes('parsedRes?.credited === false'));
  assert.ok(worker.includes('parsedRes?.already_credited === true'));
  assert.doesNotMatch(worker, /parsedRes\?\.code\s*===\s*['"](?:DEPOSIT_CREDITED|ALREADY_PROCESSED)['"]/);
});

test('forward SQL migration aligns legacy function-body response shapes with the worker contract', () => {
  assert.match(migration, /to_regprocedure\([\s\S]*process_deposit_atomic/);
  assert.match(migration, /ALREADY_CREDITED/);
  assert.match(migration, /CONFIRMED/);
  assert.match(migration, /''credited'', false/);
  assert.match(migration, /''already_credited'', true/);
  assert.match(migration, /''credited'', true/);
  assert.match(migration, /''already_credited'', false/);
  assert.match(migration, /Expected one ALREADY_CREDITED and one CONFIRMED success response/);
});

test('worker never treats a status string alone as a successful credit', () => {
  assert.match(worker, /parsedRes\?\.success === true && \([\s\S]*?parsedRes\?\.status === 'ALREADY_CREDITED'[\s\S]*?\);/);
});
