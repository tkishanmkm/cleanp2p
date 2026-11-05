import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checker = resolve('scripts/check-migration-versions.mjs');
function runChecker(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'cleanp2p-migration-preflight-'));
  try {
    for (const name of entries) writeFileSync(join(dir, name), '-- fixture only\n');
    return spawnSync(process.execPath, [checker, dir], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('accepts unique 14-digit migration versions', () => {
  const result = runChecker(['20261021010000_first.sql', '20261021020000_second.sql']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREFLIGHT PASSED/);
});

test('blocks nonstandard version filenames', () => {
  const result = runChecker(['20260908_schema_and_metrics_patch.sql']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /INVALID_FILENAME/);
});

test('blocks duplicate version prefixes regardless of description', () => {
  const result = runChecker(['20261021010000_first.sql', '20261021010000_second.sql']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DUPLICATE_VERSION/);
});

test('handles an empty migrations directory without false positives', () => {
  const result = runChecker([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PREFLIGHT PASSED/);
});
