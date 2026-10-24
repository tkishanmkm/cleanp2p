import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('supabase/functions/exec-sql/index.ts', 'utf8');
assert.match(source, /ADMIN_SQL_ENDPOINT_RETIRED/);
assert.match(source, /status: 410/);
assert.doesNotMatch(source, /\.unsafe\s*\(/);
assert.doesNotMatch(source, /SUPABASE_DB_URL/);
assert.doesNotMatch(source, /EMAIL_FUNCTION_AUTH_SECRET/);
assert.doesNotMatch(source, /req\.json\(/);
console.log('retired exec-sql edge function assertions passed (6 assertions)');
