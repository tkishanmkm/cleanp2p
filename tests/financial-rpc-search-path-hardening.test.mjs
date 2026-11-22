import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261031150000_configure_transfer_and_escrow_fees.sql',
  'utf8',
);

test('both SECURITY DEFINER financial RPCs are restricted to pg_catalog lookup', () => {
  assert.equal((migration.match(/SET search_path TO pg_catalog/g) || []).length, 2);
  assert.match(migration, /Could not locate execute_internal_transfer search_path; aborting/i);
  assert.match(migration, /Could not locate initiate_trade_with_escrow search_path; aborting/i);
});

test('internal transfer denies non-service callers without a verified session UID', () => {
  assert.match(
    migration,
    /auth\.role\(\) <> ''service_role'' AND \(auth\.uid\(\) IS NULL OR auth\.uid\(\) <> p_sender_id\)/i,
  );
  assert.match(migration, /Could not locate transfer caller identity guard; aborting/i);
});

test('escrow accepts trusted service caller IDs only for service_role and binds user calls to auth.uid', () => {
  assert.match(migration, /IF auth\.role\(\) = ''service_role'' THEN/i);
  assert.match(migration, /Trusted service caller ID is required/i);
  assert.match(migration, /IF v_auth_uid IS NULL THEN/i);
  assert.match(migration, /session user could not be verified/i);
  assert.match(migration, /p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid/i);
  assert.match(migration, /Could not locate escrow caller identity guard; aborting/i);
});

console.log('PASS: financial SECURITY DEFINER RPC migration hardens search_path and caller identity.');
