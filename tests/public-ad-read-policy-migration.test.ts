import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const sql = readFileSync('supabase/migrations/20261019160000_restrict_public_ad_reads.sql', 'utf8');
assert.match(sql, /DROP POLICY IF EXISTS "Allow public read access for ads" ON public\.ads/i);
assert.match(sql, /CREATE POLICY "Public can read active nondeleted ads"[\s\S]*?TO public[\s\S]*?USING\s*\([\s\S]*?NOT COALESCE\(is_deleted, false\)[\s\S]*?COALESCE\(active, false\)[\s\S]*?COALESCE\(is_active, false\)[\s\S]*?status[\s\S]*?\)/i);
assert.match(sql, /CREATE POLICY "Owners can read their nondeleted ads"[\s\S]*?TO authenticated[\s\S]*?auth\.uid\(\) = user_id[\s\S]*?NOT COALESCE\(is_deleted, false\)/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
console.log('PASS: public ads reads require active/non-deleted status; owners retain access to own non-deleted ads.');
console.log('NOTE: static contract only; PostgreSQL policy execution still requires isolated database validation.');
