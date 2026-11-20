import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20261120190000_step_07_case_sensitive_btc_deposit_owner_lookup.sql',
  'utf8'
);
const ingestion = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
const verifier = readFileSync('src/lib/blockchain/verify-utxo-deposit.ts', 'utf8');

test('BTC ownership migration refuses unreviewed function or search-path drift', () => {
  assert.match(migration, /public\.process_deposit_atomic\(/);
  assert.match(migration, /pg_get_userbyid\(p\.proowner\) = 'postgres'/);
  assert.match(migration, /p\.prosecdef IS TRUE/);
  assert.match(migration, /search_path=pg_catalog/);
  assert.match(migration, /v_btc_matches <> 4 OR v_total_matches <> 4/);
});

test('BTC ownership resolution changes only the four reviewed case-insensitive comparisons', () => {
  assert.match(migration, /v_old TEXT := 'AND LOWER\(BTRIM\(address\)\) = LOWER\(v_address\)'/);
  assert.match(migration, /v_new TEXT := 'AND BTRIM\(address\) = v_address'/);
  assert.match(migration, /IF v_btc_matches <> 4 OR v_total_matches <> 4 THEN/);
  assert.match(migration, /v_updated_matches <> v_new_matches_before \+ 4/);
  assert.match(migration, /EXECUTE v_updated/);
});

test('Bitcoin scanner and verifier both require exact destination-address identity', () => {
  assert.match(ingestion, /out\.scriptpubkey_address !== btcAddr/);
  assert.match(verifier, /output\.scriptpubkey_address !== address/);
});
