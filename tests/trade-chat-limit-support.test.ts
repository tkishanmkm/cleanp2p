import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261020110000_trade_chat_limit_support_requests.sql'), 'utf8');
const route = readFileSync(join(process.cwd(), 'src/app/api/trades/[tradeId]/chat-limit-support/route.ts'), 'utf8');
const chat = readFileSync(join(process.cwd(), 'src/components/trade/trade-chat.tsx'), 'utf8');

assert.match(migration, /UNIQUE \(trade_id, user_id\)/i);
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
assert.match(migration, /REVOKE ALL ON TABLE public\.trade_chat_limit_requests FROM PUBLIC, anon, authenticated/i);
assert.match(migration, /email_status text NOT NULL DEFAULT 'pending'/i);
assert.match(route, /auth\.getUser\(\)/);
assert.match(route, /content-length/);
assert.match(route, /rawBody\.length > 4096/);
assert.match(route, /Invalid JSON body/);
assert.match(route, /Only trade participants can request chat-limit support/i);
assert.match(route, /from\('trade_chat_limit_requests'\)/);
assert.match(route, /from\('support_tickets'\)/);
assert.match(route, /support@paxones\.com/i);
assert.match(route, /functions\/v1\/send-email/);
assert.match(route, /X-Email-Function-Secret/);
assert.match(route, /email_status: emailSent \? 'sent' : 'failed'/);
assert.match(route, /Support ticket ID/);
assert.match(chat, /chat-limit-support/);
assert.match(chat, /TRADE_CHAT_LIMIT_REACHED/);
assert.match(chat, /100-message limit remains enforced/i);
console.log('PASS: chat-limit support escalation source-contract checks');
console.log('NOTE: static checks do not prove PostgreSQL migration compatibility, RLS behavior, or email delivery.');
