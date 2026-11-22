import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20261030210000_contain_legacy_withdrawal_claim_rpcs.sql',
  'utf8',
);

test('legacy claim RPC signatures are preflighted before changing grants', () => {
  assert.match(migration, /to_regprocedure\('public\.claim_pending_withdrawals\(integer\)'\)/i);
  assert.match(migration, /to_regprocedure\('public\.claim_next_pending_withdrawal\(\)'\)/i);
  assert.match(migration, /DO \$preflight\$[\s\S]*?END;\s*\$preflight\$;/i);
});

test('both legacy claim RPCs are denied to service and auth-facing roles', () => {
  for (const signature of [
    'public.claim_pending_withdrawals(integer)',
    'public.claim_next_pending_withdrawal()',
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const revoke = new RegExp(
      `REVOKE ALL ON FUNCTION ${escaped}[\\s\\S]*?FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin`,
      'i',
    );
    const grant = new RegExp(
      `GRANT EXECUTE ON FUNCTION ${escaped} TO postgres`,
      'i',
    );
    assert.match(migration, revoke, `${signature} must be revoked from service_role and supabase_auth_admin`);
    assert.match(migration, grant, `${signature} should remain available to postgres for controlled maintenance`);
  }
});

test('migration warns against isolated production application before lease-aware worker is deployed', () => {
  assert.match(migration, /Never apply this migration by itself to production/i);
  assert.match(migration, /pause legacy dispatch/i);
});
