import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('src/lib/services/withdrawalService.ts', 'utf8');
const wrapper = readFileSync('supabase/migrations/20261019180000_add_idempotent_withdrawal_wrapper.sql', 'utf8');
const replay = readFileSync('supabase/migrations/20261020200000_withdrawal_idempotency_replay_lookup.sql', 'utf8');
const insertRepair = readFileSync('supabase/migrations/20261026160000_fix_onchain_withdrawal_idempotency_insert.sql', 'utf8');

function fingerprintExpression(source) {
  const start = source.indexOf('v_fingerprint := md5(concat_ws');
  assert.notEqual(start, -1, 'fingerprint expression should exist');
  const end = source.indexOf('));', start);
  assert.notEqual(end, -1, 'fingerprint expression should close');
  return source.slice(start, end + 3).replace(/\s+/g, ' ').trim();
}

test('request and replay lookup use the same withdrawal-intent fingerprint', () => {
  assert.equal(fingerprintExpression(wrapper), fingerprintExpression(replay));
});

test('wrapper serializes same-user requests before replay lookup and reservation', () => {
  assert.match(wrapper, /PERFORM 1 FROM public\.profiles WHERE id = p_user_id FOR UPDATE/i);
  assert.match(wrapper, /FROM public\.withdrawal_idempotency_keys[\s\S]*?WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key\s+FOR UPDATE/i);
  assert.ok(wrapper.indexOf('PERFORM 1 FROM public.profiles') < wrapper.indexOf('public.request_withdrawal('));
  assert.ok(wrapper.indexOf('public.request_withdrawal(') < wrapper.indexOf('INSERT INTO public.withdrawal_idempotency_keys'));
});

test('same key with different intent fails closed rather than returning another request', () => {
  assert.match(wrapper, /v_existing\.request_fingerprint IS DISTINCT FROM v_fingerprint[\s\S]*?RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT'/i);
  assert.match(replay, /v_existing\.request_fingerprint IS DISTINCT FROM v_fingerprint[\s\S]*?RAISE EXCEPTION 'IDEMPOTENCY_KEY_CONFLICT'/i);
});

test('application uses idempotent reservation and replay lookup, not direct request RPC', () => {
  assert.match(service, /rpc\('request_withdrawal_idempotent'/i);
  assert.match(service, /rpc\('lookup_withdrawal_idempotency_replay'/i);
  assert.doesNotMatch(service, /rpc\('request_withdrawal'\s*,/i);
});

test('on-chain insert repair fails closed if expected schema or function body has drifted', () => {
  assert.match(insertRepair, /IF v_signature IS NULL THEN[\s\S]*?RAISE EXCEPTION/i);
  assert.match(insertRepair, /IF v_column_count <> 1 THEN[\s\S]*?RAISE EXCEPTION/i);
  assert.match(insertRepair, /IF v_patched = v_normalized[\s\S]*?RAISE EXCEPTION/i);
});

test('source tests do not claim PostgreSQL concurrency or deployed catalog verification', () => {
  assert.match(wrapper, /Local migration only/i);
  assert.match(replay, /validate with a clean PostgreSQL migration replay/i);
});
