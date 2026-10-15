import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Static guard only: this verifies that the candidate migration preserves key
// safety properties in source. It does NOT execute SQL or replace DB integration tests.
const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261015130000_restore_p2p_trade_fee_ledger_on_release.sql'
);
const sql = readFileSync(migrationPath, 'utf8');
const ledgerHelperPath = join(
  process.cwd(),
  'supabase/migrations/20260928000000_platform_ledger_entries.sql'
);
const ledgerHelperSql = readFileSync(ledgerHelperPath, 'utf8');

assert.match(ledgerHelperSql, /'trade_fee_collected'/,
  'platform ledger schema must permit trade fee entries');
assert.match(ledgerHelperSql, /asset_code TEXT NOT NULL[\s\S]*?REFERENCES public\.assets\(code\)/,
  'platform fee asset must reference a registered asset code');
assert.match(ledgerHelperSql, /amount NUMERIC\(36,18\) NOT NULL[\s\S]*?CHECK \(amount > 0\)/,
  'platform ledger must reject zero or negative fee entries');
assert.match(ledgerHelperSql, /idempotency_key TEXT NOT NULL UNIQUE/,
  'platform ledger must enforce unique idempotency keys');
assert.match(ledgerHelperSql, /ON CONFLICT \(idempotency_key\) DO NOTHING/,
  'platform ledger helper must make repeated inserts idempotent');
assert.match(ledgerHelperSql, /v_existing\.entry_type IS DISTINCT FROM p_entry_type[\s\S]*?v_existing\.amount IS DISTINCT FROM p_amount/,
  'reused idempotency keys must reject conflicting financial fields');

const releaseStart = sql.indexOf('CREATE OR REPLACE FUNCTION public.release_trade_escrow');
assert.notEqual(releaseStart, -1, 'migration must redefine release_trade_escrow');
const releaseEnd = sql.indexOf('$function$;', releaseStart + 3);
assert.notEqual(releaseEnd, -1, 'release function must terminate');
const releaseFn = sql.slice(releaseStart, releaseEnd + '$function$;'.length);

assert.match(releaseFn, /Caller ID mismatch: unauthorized impersonation\./,
  'caller identity mismatch guard must remain');
assert.match(releaseFn, /FROM public\.trades[\s\S]*?FOR UPDATE/,
  'trade row must be locked before settlement');
assert.match(releaseFn, /v_total_escrow := v_trade\.crypto_amount \+ COALESCE\(v_trade\.escrow_fee, 0\.0\)/,
  'total escrow must include fee');
assert.equal((releaseFn.match(/record_platform_ledger_entry\(/g) ?? []).length, 2,
  'fee helper must be used for settlement and completed-trade replay');
assert.equal((releaseFn.match(/'pf_p2pfee_' \|\| p_trade_id::TEXT/g) ?? []).length, 2,
  'settlement and replay must share deterministic fee idempotency key');
assert.match(releaseFn, /IF COALESCE\(v_trade\.escrow_fee, 0\) > 0 THEN[\s\S]*?p_entry_type := 'trade_fee_collected'/,
  'positive fee must create a platform fee ledger entry');
assert.match(releaseFn, /'completed'[\s\S]*?Already released \(idempotent success\)/,
  'completed-trade replay path must remain');
assert.match(releaseFn, /v_is_paid :=[\s\S]*?escrow_status::TEXT, ''\)\) IN \('paid', 'completed', 'released'\)/,
  'completed or released escrow state must not be rejected by the paid-state guard');

const replayStart = releaseFn.indexOf('-- 6. Terminal State & Replay Safety');
const replayEnd = releaseFn.indexOf('-- 7. Atomic Financial Settlement Mutations', replayStart);
assert.ok(replayStart >= 0 && replayEnd > replayStart,
  'replay and settlement sections must remain separately identifiable');
const replaySection = releaseFn.slice(replayStart, replayEnd);
assert.ok(replaySection.indexOf('record_platform_ledger_entry(') < replaySection.indexOf('RETURN jsonb_build_object('),
  'replay must ensure the platform fee entry before returning success');

const settlementFeeCall = releaseFn.indexOf('record_platform_ledger_entry(', replayEnd);
const tradeCompletionUpdate = releaseFn.indexOf('UPDATE public.trades', settlementFeeCall);
assert.ok(settlementFeeCall > replayEnd && tradeCompletionUpdate > settlementFeeCall,
  'settlement must record the platform fee before marking the trade completed');
assert.match(releaseFn, /v_crypto_symbol := UPPER\\(NULLIF\\(TRIM\\(v_trade\\.crypto::TEXT\\), ''\\)\\)/,
  'ledger asset code must be normalized before use');
assert.match(releaseFn, /p_asset_code := v_crypto_symbol[\s\S]*?p_amount := v_trade\.escrow_fee[\s\S]*?p_direction := 'CREDIT'/,
  'fee entry must use the trade asset, recorded fee amount, and CREDIT direction');
assert.match(releaseFn, /'trade_id', p_trade_id[\s\S]*?'escrow_fee', v_trade\.escrow_fee[\s\S]*?'seller_id', v_trade\.seller_id/,
  'fee metadata must identify the trade, fee, and seller');
assert.match(releaseFn, /SECURITY DEFINER[\\s\\S]*?SET search_path TO 'public', 'pg_temp'/,
  'existing privileged function execution context and fixed search path must remain');
assert.match(releaseFn, /v_is_admin := public\\.is_admin\\(\\)/,
  'live admin authorization helper must be preserved');
assert.doesNotMatch(releaseFn, /raw_user_meta_data|user_metadata/i,
  'escrow authorization must not trust user-editable metadata');
assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/,
  'migration must be transaction-wrapped');

console.log('PASS: escrow fee migration static safety checks');
console.log('NOTE: run integration tests against a fully initialized disposable Supabase project before deployment.');
