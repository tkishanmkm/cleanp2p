import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const helper = readFileSync('src/lib/admin.ts', 'utf8');
const resolveStart = helper.indexOf('export async function resolveDispute(');
const resolveEnd = helper.indexOf('export async function updateSupportTicketStatus', resolveStart);
const resolveSource = helper.slice(resolveStart, resolveEnd);

test('browser dispute helper never calls financial RPCs or writes dispute state directly', () => {
  assert.notEqual(resolveStart, -1, 'dispute helper must remain available to callers');
  assert.notEqual(resolveEnd, -1, 'helper boundary must be identifiable');
  assert.doesNotMatch(resolveSource, /\.rpc\(['"](?:release_trade_escrow|cancel_p2p_trade|resolve_trade_dispute)['"]/);
  assert.doesNotMatch(resolveSource, /\.from\(['"]disputes['"]\)\s*\n\s*\.update\(/);
  assert.doesNotMatch(resolveSource, /\.from\(['"]trade_messages['"]\)\s*\n\s*\.insert\(/);
});

test('browser dispute helper delegates only to the authenticated server route and requires atomic audit confirmation', () => {
  assert.match(resolveSource, /fetch\(['"]\/api\/admin\/disputes\/resolve['"]/);
  assert.match(resolveSource, /disputeId:\s*dispute\.id/);
  assert.match(resolveSource, /tradeId:\s*trade\.id/);
  assert.match(resolveSource, /winnerId/);
  assert.match(resolveSource, /result\?\.settlementSucceeded !== true/);
  assert.match(resolveSource, /result\?\.audit_logged !== true/);
  assert.match(resolveSource, /response\.ok/);
});

console.log('PASS: client dispute helper no longer has direct escrow or dispute-row mutation authority.');
console.log('NOTE: the server route remains intentionally unavailable until the atomic RPC passes PostgreSQL rehearsal.');
