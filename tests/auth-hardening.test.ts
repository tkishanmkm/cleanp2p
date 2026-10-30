import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const callback = readFileSync(resolve(process.cwd(), 'src/app/api/auth/callback/route.ts'), 'utf8');
assert.ok(callback.includes('if (!authSucceeded)'), 'OAuth callback must fail closed if code exchange did not authenticate a user');
assert.ok(callback.includes("failureUrl.searchParams.set('error', 'oauth_callback_failed')"), 'OAuth callback must report an explicit failure');
assert.ok(callback.includes('${trustedOrigin}'), 'OAuth popup postMessage must use a trusted origin');
assert.ok(!callback.includes("OAUTH_AUTH_SUCCESS' }, '*'"), 'OAuth callback must not send auth success messages to wildcard origin');

const captcha = readFileSync(resolve(process.cwd(), 'src/app/api/admin/auth/verify-captcha/route.ts'), 'utf8');
assert.ok(captcha.includes('if (!hcaptchaSecret)'), 'Admin CAPTCHA must detect missing provider secret');
assert.ok(captcha.includes("status: 503"), 'Admin CAPTCHA must fail closed if provider configuration is missing');
assert.ok(!captcha.includes('Notice: HCAPTCHA_SECRET_KEY is not configured on server.'), 'Missing CAPTCHA secret must not be treated as success');

console.log('Auth hardening source guards passed.');
