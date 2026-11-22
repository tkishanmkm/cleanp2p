import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031150000_configure_transfer_and_escrow_fees.sql',
  'utf8'
);
const validator = readFileSync('src/lib/transfer-rpc-validation.ts', 'utf8');
const route = readFileSync('src/app/api/wallet/transfer/route.ts', 'utf8');

assert.match(sql, /to_regprocedure\('public\.execute_internal_transfer/i);
assert.match(sql, /key = ''platform_fee_percent''/i);
assert.match(sql, /v_recipient_amount := ROUND\(p_gross_amount, 8\)/i);
assert.match(sql, /v_fee_amount := ROUND\(v_recipient_amount \* v_fee_rate, 8\)/i);
assert.match(sql, /v_total_deduction := v_recipient_amount \+ v_fee_amount/i);
assert.match(sql, /''gross_amount'', v_recipient_amount/i);
assert.match(sql, /''net_amount'', v_recipient_amount/i);
assert.match(sql, /''total_deduction'', v_total_deduction/i);
assert.match(sql, /''legacy_fee_model''/i);
assert.match(sql, /''idempotent_replay'', TRUE/i);
assert.match(sql, /''idempotent_replay'', FALSE/i);
assert.match(sql, /key = ''escrow_fee_percent''/i);
assert.ok(sql.includes("ROUND(v_existing_transfer.amount, 8) IS DISTINCT FROM ROUND(p_gross_amount, 8) AND ROUND(v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, 0), 8) IS DISTINCT FROM ROUND(p_gross_amount, 8)"));
assert.match(sql, /v_escrow_fee := ROUND\(v_crypto_amount \* v_escrow_fee_rate, 8\)/i);
assert.match(sql, /IF NOT FOUND OR v_escrow_fee_rate IS NULL/i);
assert.match(validator, /expected\.feeRate/);
assert.match(route, /feeRate: transferFeeRate/);
assert.match(route, /getPlatformFeeSettings\(\)/);

assert.equal((sql.match(/SET search_path TO pg_catalog/g) || []).length, 2);
assert.match(sql, /auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_sender_id/i);
assert.match(sql, /auth\.role\(\) = ''service_role''/i);
assert.match(sql, /Trusted service caller ID is required/i);
assert.match(sql, /session user could not be verified/i);
assert.match(sql, /Could not locate execute_internal_transfer search_path/i);
assert.match(sql, /Could not locate initiate_trade_with_escrow search_path/i);

console.log('PASS: transfer and escrow RPCs use configured fees, receipt-compatible totals, and hardened SECURITY DEFINER identity/search_path guards.');
console.log('NOTE: database function rewrite must be replayed on a schema-matched disposable PostgreSQL instance before production use.');
