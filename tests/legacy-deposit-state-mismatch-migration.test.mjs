import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261028160000_fail_closed_legacy_deposit_state_mismatch.sql', import.meta.url), 'utf8');

test('legacy deposit guard migration is forward-only and patches only the reviewed function signature', () => {
  assert.match(sql, /to_regprocedure\([\s\S]*process_deposit_atomic\(text,text,text,numeric,text,integer,bigint,text,text,integer,text\)/i);
  assert.match(sql, /pg_get_functiondef\(v_signature\)/i);
  assert.match(sql, /expected exactly one pending and ledger marker/i);
  assert.match(sql, /v_ledger_marker text := '    IF v_ledger_count > 1 THEN'/i);
  assert.match(sql, /v_ledger_count = 1/i);
  assert.match(sql, /reference_id = v_deposit_id::TEXT/i);
  assert.match(sql, /EXECUTE v_definition/i);
  assert.doesNotMatch(sql, /DROP FUNCTION/i);
  assert.doesNotMatch(sql, /UPDATE public\.wallet_assets/i);
});

test('legacy deposit guard prevents terminal rows from being reset to pending before ledger idempotency checks', () => {
  assert.match(sql, /v_marker text := '    -- PENDING DEPOSIT'/i);
  assert.match(sql, /IF NOT v_is_confirmed AND \([\s\S]*v_existing_deposit\.status[\s\S]*'CONFIRMED', 'CREDITED'[\s\S]*v_existing_onchain\.status[\s\S]*'CONFIRMED', 'CREDITED'/i);
  assert.match(sql, /'code', 'DEPOSIT_STATE_INCONSISTENT'/i);
  assert.match(sql, /Deposit output has terminal state or an existing ledger entry and cannot be re-registered as pending/i);
  assert.match(sql, /EXISTS \([\s\S]*FROM public\.ledger_entries le[\s\S]*le\.reference_id = v_existing_deposit\.id::TEXT/i);
  assert.match(sql, /replace\(v_definition, v_marker, v_guard \|\| v_marker\)/i);
  assert.match(sql, /status = ''PENDING''/i);
  assert.match(sql, /v_ledger_count = 0 AND \([\s\S]*Terminal deposit output has no matching ledger entry/i);
  assert.ok(sql.indexOf('v_ledger_marker text := \'    IF v_ledger_count > 1 THEN\'') > 0);
  assert.ok(sql.indexOf('v_ledger_marker, v_ledger_guard || v_ledger_marker') > 0);
});
