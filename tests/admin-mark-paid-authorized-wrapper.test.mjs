import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrapperMigration = readFileSync(
  'supabase/migrations/20261031111719_require_server_mediated_admin_trade_actions.sql',
  'utf8',
);
const hardeningMigration = readFileSync(
  'supabase/migrations/20261101111500_harden_admin_mark_paid_wrapper_identity.sql',
  'utf8',
);
const start = wrapperMigration.indexOf('CREATE OR REPLACE FUNCTION public.admin_mark_trade_paid_authorized(');
const end = wrapperMigration.indexOf('$function$;', start);
const body = wrapperMigration.slice(start, end);

test('mark-paid wrapper authenticates through service role and is patched to verify the durable active administrator', () => {
  assert.ok(start >= 0 && end > start);
  assert.match(body, /COALESCE\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/);
  assert.match(body, /FROM auth\.users AS u\s+WHERE u\.id = p_actor_id/);
  assert.match(body, /public\.mark_p2p_trade_paid\(/);
  assert.match(body, /INSERT INTO public\.admin_audit_logs/);
  assert.match(body, /'ADMIN_MARKED_TRADE_PAID'/);
  assert.doesNotMatch(body, /raw_user_meta_data/);
  assert.match(hardeningMigration, /public\.admin_mark_trade_paid_authorized\(uuid,uuid,text,text\)/);
  assert.match(hardeningMigration, /public\.check_is_admin\(p_actor_id, NULL\)/);
  assert.match(hardeningMigration, /Authenticated administrator user not found/);
  assert.match(hardeningMigration, /A full, active administrator account is required/);
});

test('wrapper retains server-only execute grants and hardening is idempotent', () => {
  assert.match(wrapperMigration, /REVOKE ALL ON FUNCTION public\.admin_mark_trade_paid_authorized[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(wrapperMigration, /GRANT EXECUTE ON FUNCTION public\.admin_mark_trade_paid_authorized[\s\S]*TO service_role, postgres/);
  assert.match(hardeningMigration, /IF position\('public\.check_is_admin\(p_actor_id, NULL\)' IN lower\(v_definition\)\) > 0 THEN/);
  assert.match(hardeningMigration, /ALTER FUNCTION public\.admin_mark_trade_paid_authorized\(UUID, UUID, TEXT, TEXT\)\s+SET search_path = ''/);
});
