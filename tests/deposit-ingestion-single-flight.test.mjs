import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/jobs/depositIngestion.ts', import.meta.url), 'utf8');

test('scheduled deposit ingestion skips overlapping scans and always releases its in-flight guard', () => {
  const start = source.indexOf('async function runScheduledDepositIngestion()');
  const end = source.indexOf('export function startDepositIngestionWorker', start);
  assert.notEqual(start, -1, 'scheduled runner exists');
  assert.notEqual(end, -1, 'worker startup follows scheduled runner');

  const runner = source.slice(start, end);
  assert.match(runner, /if \(ingestionRunInFlight\)/);
  assert.match(runner, /ingestionRunInFlight = true/);
  assert.match(runner, /await runDepositIngestion\(\)/);
  assert.match(runner, /finally\s*\{\s*ingestionRunInFlight = false;/);
  assert.match(runner, /Previous scan is still running; skipping overlapping cycle/);
});

test('initial and periodic deposit scans share the same guarded runner', () => {
  const start = source.indexOf('export function startDepositIngestionWorker');
  const end = source.indexOf('export function stopDepositIngestionWorker', start);
  const worker = source.slice(start, end);
  assert.match(worker, /void runScheduledDepositIngestion\(\)/);
  assert.match(worker, /setInterval\(\(\) => \{\s*void runScheduledDepositIngestion\(\);/);
  assert.doesNotMatch(worker, /runDepositIngestion\(\)\.catch/);
});
