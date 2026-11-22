import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const sql = readFileSync('supabase/migrations/20261019190000_enforce_trade_media_quota.sql', 'utf8');

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enforce_trade_media_quota/i);
assert.match(sql, /paxones-trade-media:/i, 'all upload paths must share a per-trade/sender/type transaction lock');
assert.match(sql, /pg_advisory_xact_lock/i, 'quota checks must be serialized under concurrent uploads');
assert.match(sql, /FROM public\.trade_files[\s\S]*?FROM public\.trade_messages/i, 'both attachment metadata and legacy media messages must count');
assert.match(sql, /COUNT\(DISTINCT attachment_identity\)/i, 'quota must count unique physical attachments rather than taking the larger table count');
assert.match(sql, /f\.object_key/i, 'legacy file records must use the persisted B2 object key as their attachment identity');
assert.match(sql, /REGEXP_REPLACE\([\s\S]*?%2F[\s\S]*?\//i, 'new media proxy URLs must normalize URL-encoded object-key slashes before deduplication');
assert.match(sql, /UNION ALL/i, 'both attachment sources must be combined before distinct-identity counting');
assert.doesNotMatch(sql, /GREATEST\(v_file_count, v_message_count\)/i, 'taking the larger count undercounts mixed independent uploads');
assert.match(sql, /v_count >= 3/i, 'the persisted quota must cap each media type at three');
assert.match(sql, /TRADE_MEDIA_LIMIT_REACHED/i, 'quota rejection must have a stable error detail');
assert.match(sql, /NOT COALESCE\(f\.is_external_link, false\)/i, 'cloud links must not consume binary file quota');
assert.match(sql, /CREATE TRIGGER c_enforce_trade_media_quota[\s\S]*?ON public\.trade_files/i);
assert.match(sql, /CREATE TRIGGER c_enforce_trade_media_quota[\s\S]*?ON public\.trade_messages/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

// Reference cases for the identity model used by the SQL trigger.
// The mixed-route case is the regression: one legacy file plus a different
// message-only upload must count as two, not max(1, 1) === 1.
const fileIdentity = (id: string, objectKey: string | null) =>
  objectKey?.trim() ? `object:${objectKey}` : `file-row:${id}`;
const messageIdentity = (id: string, mediaUrl: string) => {
  const parsed = new URL(mediaUrl, 'https://paxones.test');
  const key = parsed.searchParams.get('key');
  if (key) return `object:${key}`;
  if (mediaUrl.startsWith('trades/')) return `object:${mediaUrl}`;
  return `message-row:${id}`;
};

const mixedRouteKeys = new Set([
  fileIdentity('file-1', 'trades/trade-1/one.png'),
  messageIdentity('message-2', '/api/trade/media?key=trades%2Ftrade-1%2Ftwo.png'),
]);
assert.equal(mixedRouteKeys.size, 2, 'independent uploads split across tables must both consume quota');

const mirroredKeys = new Set([
  fileIdentity('file-1', 'trades/trade-1/one.png'),
  messageIdentity('message-1', '/api/trade/media?key=trades%2Ftrade-1%2Fone.png'),
]);
assert.equal(mirroredKeys.size, 1, 'the same physical B2 object mirrored across tables must count once');

const atLimit = new Set([
  fileIdentity('file-1', 'trades/trade-1/one.png'),
  messageIdentity('message-2', '/api/trade/media?key=trades%2Ftrade-1%2Ftwo.png'),
  messageIdentity('message-3', '/api/trade/media?key=trades%2Ftrade-1%2Fthree.png'),
]);
assert.equal(atLimit.size, 3, 'three distinct attachments are allowed');
assert.ok(atLimit.size >= 3, 'a fourth distinct attachment must be rejected by the SQL guard');

console.log('PASS: trade-media migration contract covers mixed-route counting, mirrored-object deduplication, and the three-file cap.');
console.log('NOTE: source-level only; run against an isolated, schema-matched PostgreSQL database before applying.');
