import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const authPath = path.join(process.cwd(), 'src/lib/server-admin-auth.ts');
const auth = readFileSync(authPath, 'utf8');
const clientAuth = readFileSync(path.join(process.cwd(), 'src/components/providers/auth-provider.tsx'), 'utf8');

assert.ok(auth.includes('user.app_metadata?.role === "admin"'), 'server-managed app_metadata role should be supported');
assert.ok(auth.includes('user.app_metadata?.is_admin === true'), 'server-managed app_metadata is_admin should be supported');
assert.ok(!/user\.user_metadata\?\.(?:role|is_admin)/.test(auth), 'user-editable metadata must never grant server admin privileges');
assert.ok(!/supabaseUser\.user_metadata\?\.role/.test(clientAuth), 'user-editable metadata must never grant client admin UI privileges');

console.log('PASS: server and client admin authorization do not trust user-editable role metadata');
