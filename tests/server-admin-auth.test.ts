import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/server-admin-auth.ts'),
  'utf8',
);

assert.ok(
  source.includes('user.app_metadata?.role === "admin"'),
  'server-side admin authorization may use server-managed app_metadata',
);
assert.ok(
  !source.includes('user.user_metadata?.role'),
  'server-side admin authorization must never trust user-editable user_metadata',
);
assert.ok(
  source.includes('.from("app_admins")'),
  'the canonical app_admins registry must remain an authorization source',
);
assert.ok(
  source.includes('process.env.ADMIN_EMAILS'),
  'the explicitly configured server-side admin allowlist must remain available',
);

console.log('Server admin authorization source guards passed.');
