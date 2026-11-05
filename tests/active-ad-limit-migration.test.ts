import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const sql = readFileSync('supabase/migrations/20261017170600_enforce_user_active_ad_limit.sql', 'utf8');

assert.match(sql, /maximum of 10 active ads per user/i);
assert.match(sql, /IF v_active_count >= 10 THEN/i);
assert.match(sql, /maximum of 10 active advertisements/i);
assert.match(sql, /pg_advisory_xact_lock|FOR UPDATE/i, 'activation must be serialized per account');
assert.match(sql, /FROM public\.ads[\s\S]*?UNION ALL[\s\S]*?FROM public\.p2p_ads/i, 'both canonical and legacy ad stores must be counted');
assert.match(sql, /is_banned[\s\S]*?is_restricted[\s\S]*?is_suspended/i, 'disabled accounts must not publish active ads');
assert.match(sql, /CREATE TRIGGER enforce_user_active_ad_limit_ads_insert/i);
assert.match(sql, /CREATE TRIGGER enforce_user_active_ad_limit_p2p_ads_insert/i);
assert.match(sql, /BEFORE UPDATE OF user_id, active, is_active, is_deleted, status, public_ad_id ON public\.ads/i,
  'changing an ad public ID must re-run the active-ad limit guard');
assert.match(sql, /BEFORE UPDATE OF user_id, active, is_active, is_deleted, status, public_ad_id ON public\.p2p_ads/i,
  'changing a legacy ad public ID must re-run the active-ad limit guard');
assert.match(sql, /IF NULLIF\(NEW\.public_ad_id, ''\) IS NOT NULL THEN[\s\S]*?TG_OP <> 'UPDATE' OR a\.id::text <> NEW\.id::text/i,
  'public IDs must remain unique within each table during updates');
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

console.log('PASS: active-ad migration contract enforces a maximum of 10 active ads across canonical and legacy stores.');
console.log('NOTE: source-level contract only; PostgreSQL execution still requires an isolated schema-matched database.');
