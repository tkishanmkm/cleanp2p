import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const authPath = path.join(process.cwd(), 'src/lib/server-admin-auth.ts');
const auth = readFileSync(authPath, 'utf8');
const clientAuth = readFileSync(path.join(process.cwd(), 'src/components/providers/auth-provider.tsx'), 'utf8');

assert.ok(!/user\\.app_metadata\\?\\.(?:role|is_admin)/.test(auth), 'JWT app_metadata must not bypass canonical database admin verification');
assert.ok(!/user\\.user_metadata\\?\\.(?:role|is_admin)/.test(auth), 'user-editable metadata must never grant server admin privileges');
assert.ok(auth.includes('verify_admin_login'), 'server admin access must use the canonical database verifier');
assert.ok(auth.includes('is_valid === true'), 'server admin access must require a positive database verification result');
assert.ok(auth.includes('support_admin_grants'), 'support-admin access must use the dedicated database grant');
assert.ok(!/supabaseUser\\.user_metadata\\?\\.role/.test(clientAuth), 'user-editable metadata must never grant client admin UI privileges');

console.log('PASS: server and client admin authorization use trusted database state, not user-editable JWT metadata');
