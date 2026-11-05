import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync('supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql', 'utf8');
const lower = migration.toLowerCase();

test('forward migration replaces legacy overloads and exposes revert flag for worker', () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.process_failed_withdrawal\(UUID, TEXT, NUMERIC, TEXT, BOOLEAN\)/i);
  assert.match(migration, /CREATE FUNCTION public\.process_failed_withdrawal\([\s\S]*?p_is_verified_revert BOOLEAN DEFAULT FALSE,\s*p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i);
  assert.match(migration, /SET search_path = ''/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.process_failed_withdrawal[\s\S]*?FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.process_failed_withdrawal[\s\S]*?TO service_role, postgres/i);
});

test('caller-controlled unbroadcast flag cannot bypass broadcast protections', () => {
  assert.match(migration, /IF COALESCE\(p_is_verified_unbroadcast, FALSE\) THEN[\s\S]*?RAISE EXCEPTION/i);
  assert.match(migration, /cannot refund a withdrawal with a recorded transaction hash\/txid/i);
  assert.match(migration, /PROCESSING and[\s\S]*?AMBIGUOUS_BROADCAST/i);
  assert.match(migration, /verified revert requires a persisted transaction hash/i);
  assert.match(migration, /paired withdrawal transaction hash mismatch/i);
});

test('refund uses deployed ledger columns and exact locked-liability checks', () => {
  assert.match(migration, /v_balance\.in_withdrawal < v_gross[\s\S]*?RAISE EXCEPTION/i);
  assert.doesNotMatch(migration, /GREATEST\s*\(\s*0\s*,\s*in_withdrawal\s*-\s*v_gross/i);
  assert.match(migration, /INSERT INTO public\.ledger_entries \([\s\S]*?user_id, crypto, amount, type, reference_id, balance_after, metadata,[\s\S]*?asset, chain, status, created_at/i);
  assert.match(migration, /'withdrawal'[\s\S]*?'REFUNDED'/i);
  assert.doesNotMatch(migration, /wallet_id,\s*user_id,\s*asset_code,\s*delta_available/i);
  assert.match(migration, /v_gross := v_withdrawal\.amount \+ COALESCE\(v_paired\.network_fee, 0\)/i);
  assert.match(migration, /paired withdrawal identity\/amount\/asset\/network mismatch/i);
  assert.doesNotMatch(migration, /v_withdrawal\.fee/i);
});

test('refund locks paired rows in the same order as approval to reduce deadlocks', () => {
  const pairedLock = migration.indexOf('INTO v_paired');
  const onchainLock = migration.indexOf('INTO v_withdrawal');
  assert.notEqual(pairedLock, -1, 'paired withdrawal lock must exist');
  assert.notEqual(onchainLock, -1, 'on-chain withdrawal lock must exist');
  assert.ok(pairedLock < onchainLock, 'lock withdrawals before onchain_withdrawals');
});

test('terminal retries require an existing refund ledger and paired state consistency', () => {
  assert.match(migration, /SELECT EXISTS \([\s\S]*?le\.reference_id = p_withdrawal_id::TEXT[\s\S]*?le\.status = 'REFUNDED'/i);
  assert.match(migration, /terminal state and refund ledger do not agree/i);
  assert.match(migration, /paired withdrawal record[\s\S]*?not found/i);
  assert.match(migration, /UPDATE public\.withdrawals[\s\S]*?status = 'failed'/i);
  assert.match(migration, /UPDATE public\.onchain_withdrawals[\s\S]*?status = 'FAILED'/i);
});

test('function does not trust legacy metadata or clamped liability arithmetic', () => {
  assert.doesNotMatch(lower, /v_withdrawal\.metadata/);
  assert.doesNotMatch(lower, /greatest\s*\(\s*0\s*,\s*in_withdrawal/);
  assert.doesNotMatch(lower, /p_is_verified_unbroadcast\)\s*then[\s\S]*?balance = balance \+/i);
});
