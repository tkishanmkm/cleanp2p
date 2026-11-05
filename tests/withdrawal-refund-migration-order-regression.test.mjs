import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const forward = readFileSync('supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql', 'utf8');
const later = readFileSync('supabase/migrations/20261026141000_fail_closed_withdrawal_refunds.sql', 'utf8');
const activeLater = later.split('/* DISABLED unsafe historical implementation')[0];

test('later migration preserves the hardened RPC and fails closed on missing/legacy overloads', () => {
  assert.match(forward, /CREATE FUNCTION public\.process_failed_withdrawal\([\s\S]*?p_is_verified_revert BOOLEAN DEFAULT FALSE,[\s\S]*?p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i);
  assert.match(activeLater, /to_regprocedure\('public\.process_failed_withdrawal\(uuid,text,numeric,text,boolean,boolean\)'\)/i);
  assert.match(activeLater, /to_regprocedure\('public\.process_failed_withdrawal\(uuid,text,numeric,text,boolean\)'\)/i);
  assert.match(activeLater, /IF v_hardened_signature IS NULL[\s\S]*?RAISE EXCEPTION/i);
  assert.match(activeLater, /IF v_legacy_signature IS NOT NULL[\s\S]*?RAISE EXCEPTION/i);
  assert.doesNotMatch(activeLater, /CREATE OR REPLACE FUNCTION public\.process_failed_withdrawal/i);
  assert.match(later, /DISABLED unsafe historical implementation/i);
});

test('later migration cannot reintroduce caller-controlled refund flags or incompatible ledger columns', () => {
  assert.doesNotMatch(activeLater, /p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i);
  assert.doesNotMatch(activeLater, /wallet_id,[\s\S]*?asset_code,[\s\S]*?delta_available,[\s\S]*?idempotency_key/i);
  assert.match(forward, /user_id, crypto, amount, type, reference_id, balance_after, metadata,[\s\S]*?asset, chain, status/i);
});
