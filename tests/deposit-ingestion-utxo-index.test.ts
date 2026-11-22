import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/jobs/depositIngestion.ts'), 'utf8');

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing section end: ${endMarker}`);
  return source.slice(start, end);
}

test('BTC ingestion registers each matching UTXO output independently', () => {
  const btc = section('async function scanBtcDeposits(', 'async function scanLtcDeposits(');
  assert.match(btc, /for \(let i = 0; i < \(tx\.vout \|\| \[\]\)\.length; i\+\+\)/);
  assert.match(btc, /p_amount: btcAmount/);
  assert.match(btc, /p_output_index: i/);
  assert.doesNotMatch(btc, /outputAmountSat \+=/);
});

test('LTC ingestion registers each matching UTXO output independently', () => {
  const ltc = section('async function scanLtcDeposits(', 'export async function refreshPendingDepositConfirmations(');
  assert.match(ltc, /for \(let i = 0; i < \(tx\.vout \|\| \[\]\)\.length; i\+\+\)/);
  assert.match(ltc, /p_amount: ltcAmount/);
  assert.match(ltc, /p_output_index: i/);
  assert.doesNotMatch(ltc, /outputAmountLit \+=/);
});

test('TRON ingestion rejects missing or malformed event indexes instead of guessing zero', () => {
  const tronStart = source.indexOf('for (const log of allLogs)');
  const tronEnd = source.indexOf('return { detected, credited, errors };', tronStart);
  assert.notEqual(tronStart, -1);
  assert.notEqual(tronEnd, -1);
  const tron = source.slice(tronStart, tronEnd);
  assert.match(tron, /typeof log\.logIndex !== 'string'/);
  assert.match(tron, /Number\.parseInt\(log\.logIndex, 16\)/);
  assert.match(tron, /Number\.isSafeInteger\(outputIndex\)/);
  assert.doesNotMatch(tron, /parseInt\(log\.logIndex \|\| '0x0'/);
});

test('TRON account and contract event ingestion require the persisted event index', () => {
  assert.match(source, /item\.event_index === undefined \|\| item\.event_index === null/);
  assert.match(source, /evt\.event_index === undefined \|\| evt\.event_index === null/);
  assert.match(source, /p_output_index: outputIndex/);
  assert.doesNotMatch(source, /const outputIndex = evt\.event_index !== undefined[^;]*: 0/);
});

test('legacy pending refresh cannot fabricate indexes, re-register deposits, or claim credits', () => {
  const start = source.indexOf('export async function refreshPendingDepositConfirmations()');
  const end = source.indexOf('export async function runDepositIngestion()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const refresh = source.slice(start, end);
  assert.match(refresh, /return \{ checked: 0, newlyCredited: 0 \}/);
  assert.doesNotMatch(refresh, /register_pending_deposit|process_deposit_atomic|getTransactionReceipt|getTransactionInfo|parseInt\(|output_index.*\?\?.*0/);
});
