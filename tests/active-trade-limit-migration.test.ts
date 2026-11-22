import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20261020100000_enforce_user_active_trade_limit.sql',
);
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

assert.match(sql, /create or replace function public\.enforce_user_active_trade_limit/);
assert.match(sql, /before insert on public\.trades/);
assert.match(sql, /execute function public\.enforce_user_active_trade_limit/);
assert.match(sql, /active_count >= 20/);
assert.match(sql, /for update/);
assert.match(sql, /order by participant_id/);
assert.match(sql, /t\.buyer_id::text = v_user_id::text or t\.seller_id::text = v_user_id::text/);
assert.match(sql, /active_trade_limit_reached/);
assert.match(sql, /'completed'.*'released'.*'cancelled'.*'canceled'.*'expired'.*'resolved'.*'refunded'/s);
assert.match(sql, /not \([\s\S]*lower\(coalesce\(t\.status::text, ''\)\) = any\(v_terminal_statuses\)[\s\S]*lower\(coalesce\(t\.escrow_status::text, ''\)\) = any\(v_terminal_statuses\)/);
assert.match(sql, /revoke all on function public\.enforce_user_active_trade_limit\(\) from public/);

console.log('PASS: active-trade cap migration statically enforces the 20-trade limit for both participants, serializes competing inserts with ordered profile row locks, and retains terminal trade history.');
console.log('NOTE: source-level only; validate migration against an isolated, schema-matched PostgreSQL database before deployment.');
