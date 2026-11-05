import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const worker = readFileSync(join(root, 'src/jobs/withdrawalWorker.ts'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20261024150000_withdrawal_confirmation_scheduling.sql'), 'utf8');

test('confirmation worker selects due transactions in deterministic scheduled order', () => {
  assert.match(worker, /\.lte\('next_confirmation_check_at', new Date\(\)\.toISOString\(\)\)/);
  assert.match(worker, /\.order\('next_confirmation_check_at', \{ ascending: true \}\)/);
  assert.match(worker, /\.order\('created_at', \{ ascending: true \}\)/);
  assert.match(worker, /\.order\('id', \{ ascending: true \}\)/);
  assert.match(worker, /\.update\(\{ next_confirmation_check_at: nextCheckAt \}\)/);
  assert.match(worker, /Do not touch updated_at: orphan detection uses it/);
});

test('forward migration adds indexed persistent confirmation scheduling without applying it', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS next_confirmation_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_onchain_withdrawals_confirmation_schedule/i);
  assert.match(migration, /WHERE status IN \('BROADCASTED', 'PROCESSING', 'AMBIGUOUS_BROADCAST'\)/i);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});
