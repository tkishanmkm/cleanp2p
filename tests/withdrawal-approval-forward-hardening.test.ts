import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const migration = readFileSync('supabase/migrations/20261024110000_withdrawal_approval_rpc_forward_hardening.sql', 'utf8');

test('approval stores approval columns on onchain_withdrawals, not withdrawals', () => {
  assert.match(migration, /UPDATE public\.onchain_withdrawals[\s\S]*?approved_by = p_admin_id[\s\S]*?approved_at = now\(\)/i);
  assert.match(migration, /UPDATE public\.withdrawals[\s\S]*?SET status = 'QUEUED',[\s\S]*?updated_at = now\(\)/i);
  assert.doesNotMatch(migration, /UPDATE public\.withdrawals[\s\S]*?approved_by\s*=/i);
});

test('approval locks and requires both paired rows before changing either', () => {
  assert.match(migration, /FROM public\.withdrawals[\s\S]*?FOR UPDATE/i);
  assert.match(migration, /FROM public\.onchain_withdrawals[\s\S]*?FOR UPDATE/i);
  assert.match(migration, /Paired on-chain withdrawal[\s\S]*?approval blocked/i);
  assert.match(migration, /Cannot approve a withdrawal with a recorded transaction hash\/txid/i);
});

test('approval verifies admin, uses a real email, and supports safe retries', () => {
  assert.match(migration, /FROM public\.app_admins WHERE user_id = p_admin_id/i);
  assert.match(migration, /SELECT email[\s\S]*?FROM public\.profiles[\s\S]*?WHERE id = p_admin_id/i);
  assert.doesNotMatch(migration, /admin_approver@paxones\.com/i);
  assert.match(migration, /upper\(COALESCE\(v_withdrawal\.status, ''\)\) = 'QUEUED'[\s\S]*?v_onchain\.approved_by IS NOT NULL[\s\S]*?'idempotent', TRUE/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.approve_withdrawal[\s\S]*?FROM PUBLIC, anon, authenticated/i);
});

const approvalRoute = readFileSync('src/app/api/admin/withdrawals/approve/route.ts', 'utf8');

test('approval API never reports QUEUED unless the authoritative RPC confirms success', () => {
  assert.match(approvalRoute, /if \(rpcError\)[\s\S]*?status: 500/);
  assert.match(approvalRoute, /parsedResult\.success !== true[\s\S]*?status: 409/);
  assert.match(approvalRoute, /success: true,[\s\S]*?data: parsedResult[\s\S]*?status: parsedResult\.status \|\| 'QUEUED'/);
});
