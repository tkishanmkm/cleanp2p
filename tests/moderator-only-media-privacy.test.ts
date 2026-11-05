import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const component = readFileSync(
  resolve(process.cwd(), 'src/components/trade/trade-chat.tsx'),
  'utf8',
);
const mediaProxy = readFileSync(
  resolve(process.cwd(), 'src/app/api/trade/media/route.ts'),
  'utf8',
);
const tradeDetailApi = readFileSync(
  resolve(process.cwd(), 'src/app/api/trades/[tradeId]/route.ts'),
  'utf8',
);

assert.match(component, /m\.visibility !== 'moderator_only' \|\| isAdmin \|\| m\.sender_id === currentUserId/);
assert.match(component, /raw\.visibility === 'moderator_only'[\s\S]{0,180}!isAdmin[\s\S]{0,100}raw\.sender_id !== currentUserId/);
assert.match(mediaProxy, /mediaMessage\.visibility === 'moderator_only'[\s\S]{0,150}!isModerator[\s\S]{0,100}mediaMessage\.sender_id !== user\.id/);
assert.match(tradeDetailApi, /msg\.visibility !== 'moderator_only'[\s\S]{0,100}isAdmin[\s\S]{0,80}msg\.sender_id === user\.id/);
assert.match(tradeDetailApi, /auth\.getUser\(\)/, 'trade detail API must verify the caller with Supabase Auth');
assert.match(tradeDetailApi, /if \(currentProfileError\)[\s\S]{0,220}status: 503/, 'profile authorization lookup errors must fail closed');
assert.match(tradeDetailApi, /if \(!currentProfile\)[\s\S]{0,120}status: 403/, 'missing account profile must not bypass account-status checks');
assert.match(tradeDetailApi, /const safeTrade = \{/);
assert.match(tradeDetailApi, /trade: safeTrade/);
assert.doesNotMatch(tradeDetailApi, /trade:\s*\{\s*\.\.\.trade/, 'raw trade rows must not be spread into the API response');

console.log('PASS: moderator-only evidence is filtered in initial chat reads, Realtime inserts, the attachment proxy, and the trade-detail API.');
console.log('NOTE: static assertions are not proof of database RLS; validate with participant/moderator sessions on an isolated schema-matched database.');
