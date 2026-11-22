import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031100000_restrict_legacy_trade_table_writes.sql',
  'utf8'
);

assert.match(sql, /DROP POLICY IF EXISTS "Users can update their own trades" ON public\.p2p_trades/i);
assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.p2p_trades FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT SELECT ON TABLE public\.p2p_trades TO authenticated/i);
assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.p2p_trades TO service_role/i);
assert.match(sql, /TO authenticated[\s\S]*?USING\s*\([\s\S]*?buyer_id = \(SELECT auth\.uid\(\)\)[\s\S]*?seller_id = \(SELECT auth\.uid\(\)\)/i);
assert.match(sql, /DROP POLICY IF EXISTS "trade_attachments_participant_insert" ON public\.trade_attachments/i);
assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.trade_attachments FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.trade_attachments TO service_role/i);
assert.doesNotMatch(sql, /CREATE POLICY[\s\S]*?ON public\.p2p_trades[\s\S]*?FOR UPDATE/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

console.log('PASS: clients cannot mutate legacy trade escrow rows or inject legacy attachments; server-role access remains.');
console.log('NOTE: static contract only; PostgreSQL migration replay and negative/positive role tests remain required.');
