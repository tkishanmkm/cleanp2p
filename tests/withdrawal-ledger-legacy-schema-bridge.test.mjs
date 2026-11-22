import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031115820_reconcile_legacy_withdrawal_ledger_schema.sql',
  'utf8',
);

test('legacy withdrawals receive the canonical wallet/idempotency fields required by request_withdrawal', () => {
  assert.match(sql, /ALTER TABLE public\.withdrawals[\s\S]*?ADD COLUMN IF NOT EXISTS wallet_id uuid[\s\S]*?ADD COLUMN IF NOT EXISTS idempotency_key text/i);
  assert.match(sql, /'chain',\s*COALESCE\([\s\S]*?v_row->>'network'/i);
  assert.match(sql, /'token_symbol',\s*COALESCE\([\s\S]*?v_row->>'asset_symbol'/i);
  assert.match(sql, /'to_address',\s*COALESCE\([\s\S]*?v_row->>'destination_address'/i);
  assert.match(sql, /CREATE TRIGGER trg_sync_withdrawals_legacy_insert_columns/i);
});

test('legacy ledger receives canonical idempotency and double-entry columns', () => {
  for (const column of [
    'wallet_id uuid', 'asset_code text', 'delta_available numeric(36,18)',
    'delta_locked numeric(36,18)', 'available_after numeric(36,18)',
    'locked_after numeric(36,18)', 'entry_type text', 'ref_table text',
    'ref_id text', 'idempotency_key text',
  ]) {
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS ' + column), 'Missing canonical ledger field ' + column);
  }
  assert.match(sql, /CREATE UNIQUE INDEX uq_ledger_entries_idempotency_key_compat/);
  assert.match(sql, /CREATE TRIGGER trg_sync_ledger_entries_legacy_insert_columns/i);
});

test('canonical ledger types map to the legacy allowed type values and unknown values fail closed', () => {
  for (const [canonical, legacy] of [
    ['deposit_credit', 'deposit'],
    ['withdrawal_lock', 'withdrawal_pending'],
    ['withdrawal_complete', 'withdrawal'],
    ['withdrawal_refund', 'withdrawal'],
    ['fee_deduction', 'fee'],
    ['escrow_lock', 'transfer'],
    ['escrow_release', 'transfer'],
    ['escrow_refund', 'transfer'],
    ['internal_transfer_debit', 'transfer'],
    ['internal_transfer_credit', 'transfer'],
    ['admin_adjustment', 'transfer'],
  ]) {
    assert.match(sql, new RegExp('WHEN \'' + canonical + '\' THEN \'' + legacy + '\''));
  }
  assert.match(sql, /IF v_legacy_type IS NULL THEN\s+RAISE EXCEPTION/i);
});

test('schema bridge preflight accepts both legacy and canonical base ledger schemas', () => {
  assert.match(sql, /SELECT count\(\*\)[\s\S]*?column_name IN \('amount', 'type'\)[\s\S]*?\) < 2/i);
  assert.match(sql, /SELECT count\(\*\)[\s\S]*?column_name IN \('entry_type', 'delta_available', 'delta_locked', 'available_after', 'locked_after', 'ref_table', 'ref_id', 'idempotency_key'\)[\s\S]*?\) < 8/i);
});

test('schema bridge performs no financial data backfill or balance mutation', () => {
  assert.match(sql, /No balances, ledger rows, withdrawal rows, or deposit rows are backfilled/i);
  assert.doesNotMatch(sql, /UPDATE public\.(wallet_assets|withdrawals|ledger_entries)|DELETE FROM public\.(withdrawals|ledger_entries)/i);
  assert.doesNotMatch(sql, /SECURITY DEFINER/i);
});