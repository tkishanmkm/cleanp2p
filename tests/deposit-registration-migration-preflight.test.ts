import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const pending = readFileSync('supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql', 'utf8');
const forward = readFileSync('supabase/migrations/20261025100000_reconcile_ltc_deposit_confirmation_threshold.sql', 'utf8');
const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');
const historical = readFileSync('supabase/migrations/20261001010000_part6k14_controlled_blocker_remediation.sql', 'utf8');

test('LTC threshold reconciliation is forward-only and refuses unexpected deployed definitions', () => {
  assert.match(forward, /to_regprocedure\('public\.process_deposit_atomic\(text,text,text,numeric,text,integer,bigint,text,text,integer,text\)'\)/);
  assert.match(forward, /Expected exactly one LTC legacy threshold token/);
  assert.match(forward, /v_required_confirmations := 6;/);
  assert.match(forward, /v_required_confirmations := 12;/);
  assert.match(forward, /EXECUTE v_definition/);
  assert.doesNotMatch(forward, /DROP FUNCTION/i);
});

test('pending registration and confirmation worker agree on all six network thresholds', () => {
  const expected = new Map([['BTC', 3], ['LTC', 12], ['ETH', 12], ['ERC20', 12], ['BEP20', 15], ['TRC20', 19]]);
  for (const [network, confirmations] of expected) {
    assert.match(pending, new RegExp(`WHEN '${network}' THEN v_expected_asset := '[A-Z]+'; v_required := ${confirmations};`));
    assert.match(worker, new RegExp(network + ': ' + confirmations + ','));
  }
});

test('historical migration remains unchanged; current forward migration reconciles the legacy LTC threshold', () => {
  assert.match(historical, /WHEN 'LTC' THEN[\s\S]{0,100}?v_required_confirmations := 6;/);
  assert.match(forward, /v_required_confirmations := 12;/);
});
