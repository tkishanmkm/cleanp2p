import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const worker = readFileSync(join(root, 'src/jobs/reconciliationWorker.ts'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20261024160000_system_alert_active_deduplication.sql'), 'utf8');

test('system alerts use stable keys and suppress duplicate active alert inserts', () => {
  assert.match(worker, /createHash\('sha256'\)/);
  assert.match(worker, /dedupe_key: dedupeKey/);
  assert.match(worker, /error\?\.code === '23505'/);
  assert.match(worker, /Deduplicate only active alerts/);
});

test('database enforces uniqueness only for unresolved keyed alerts', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS dedupe_key TEXT/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_system_alerts_active_dedupe_key/i);
  assert.match(migration, /WHERE is_resolved = FALSE AND dedupe_key IS NOT NULL/i);
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
});
