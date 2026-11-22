import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261017170500_trade_chat_message_limits_and_retention.sql",
);
const sql = readFileSync(migrationPath, "utf8");

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_trade_messages_sender\(\)/i);
assert.match(sql, /NEW\.sender_id::text IS DISTINCT FROM v_uid::text/i);
assert.match(sql, /Only trade participants may send messages to this trade\./i);
assert.doesNotMatch(sql, /firestore_trade_id/i); // The live trades schema has no such column.
assert.match(sql, /ACCOUNT_ACCESS_BLOCKED/i);
assert.match(sql, /CREATE TRIGGER a_guard_trade_messages_sender\s+BEFORE INSERT ON public\.trade_messages/i);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_trade_chat_message_limit\(\)/i);
assert.match(sql, /CREATE TRIGGER b_enforce_trade_chat_message_limit\s+BEFORE INSERT ON public\.trade_messages/i);
assert.match(sql, /CREATE TRIGGER enforce_trade_chat_message_limit\s+BEFORE INSERT ON public\.trade_chat_messages/i);
assert.match(sql, /pg_advisory_xact_lock/i);
assert.match(sql, /paxones-trade-chat:' \|\| v_canonical_trade_id \|\| ':' \|\| v_sender_id/i);
assert.match(sql, /SELECT t\.id::text, t\.trade_id::text[\s\S]*INTO v_canonical_trade_id, v_public_trade_id/i);
assert.match(sql, /trade_id::text = ANY \(ARRAY\[\$1, \$3, \$4\]\)/i);
assert.match(sql, /USING v_canonical_trade_id, v_sender_id, v_public_trade_id, v_trade_id/i);
assert.match(sql, /IF v_sender_id = '00000000-0000-0000-0000-000000000000' THEN\s+RETURN NEW;/i);
assert.match(sql, /UNION\s+SELECT c\.sender_id::text AS sender_id, c\.message::text AS message, c\.created_at/i);
assert.match(sql, /COUNT\(\*\)[\s\S]*AS logical_messages/i);
assert.match(sql, /v_message_count >= 100/i);
assert.doesNotMatch(sql, /v_message_count := v_message_count \+ COALESCE\(v_other_message_count/i);
assert.match(sql, /v_sender_id IS DISTINCT FROM v_uid::text/i);
assert.match(sql, /TRADE_CHAT_LIMIT_REACHED/i);
assert.match(sql, /TRADE_CHAT_CLOSED/i);
assert.match(sql, /COALESCE\(t\.is_disputed, false\) = false/i);
assert.match(sql, /NOW\(\) - INTERVAL '30 days'/i);
assert.match(sql, /paxones-chat-notification-retention/i);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.purge_expired_trade_chat_and_notifications\(\) FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.purge_expired_trade_chat_and_notifications\(\) TO service_role, postgres/i);

console.log("PASS: trade chat guard migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution and participant-authorization tests.");
