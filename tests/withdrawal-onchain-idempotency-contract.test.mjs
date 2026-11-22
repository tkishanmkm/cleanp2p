import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261026160000_fix_onchain_withdrawal_idempotency_insert.sql', 'utf8');

test('withdrawal RPC insert-contract patch is fail-closed and supplies the required unique idempotency key', () => {
  assert.match(migration, /to_regprocedure\('public\.request_withdrawal\(uuid,text,text,numeric,numeric,text,numeric\)'\)/);
  assert.match(migration, /a\.attname = 'idempotency_key'[\s\S]*a\.attnotnull/);
  assert.match(migration, /manual reconciliation required/);
  assert.match(migration, /'        idempotency_key,'/);
  assert.match(migration, /''w_'' \|\| v_withdrawal_id::TEXT/);
  assert.match(migration, /refusing partial migration/);
  assert.match(migration, /EXECUTE v_patched/);
});

test('withdrawal RPC idempotency patch does not disable uniqueness or relax NOT NULL', () => {
  assert.doesNotMatch(migration, /DROP\s+NOT\s+NULL|DROP\s+CONSTRAINT|SET\s+DEFAULT/i);
  assert.match(migration, /a\.attnotnull/);
});
