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
assert.ok(captcha.includes('status: 503'), 'Admin CAPTCHA must fail closed if provider configuration is missing');
assert.ok(!captcha.includes('Notice: HCAPTCHA_SECRET_KEY is not configured on server.'), 'Missing CAPTCHA secret must not be treated as success');

const forgotPassword = readFileSync(resolve(process.cwd(), 'src/app/api/auth/forgot-password/route.ts'), 'utf8');
assert.ok(forgotPassword.includes('if (!hcaptchaSecret || !hcaptchaSitekey)'), 'Password recovery CAPTCHA must fail closed when provider configuration is missing');
assert.ok(forgotPassword.includes('captchaResult?.success !== true'), 'Password recovery must require provider-verified CAPTCHA success');
assert.ok(forgotPassword.includes('AbortSignal.timeout(5_000)'), 'Password recovery CAPTCHA verification must have a bounded timeout');
assert.ok(!forgotPassword.includes("req.headers.get('origin')"), 'Password recovery redirect must not trust request Origin');
assert.ok(!forgotPassword.includes("req.headers.get('host')"), 'Password recovery redirect must not trust request Host');
assert.ok(forgotPassword.includes('getTrustedRecoveryOrigin()'), 'Password recovery redirect must use a trusted configured origin');
assert.ok(forgotPassword.includes("redirectUrl.searchParams.set('next', '/reset-password')"), 'Password recovery redirect must constrain the post-reset destination');

const blockcypherWebhook = readFileSync(resolve(process.cwd(), 'src/app/api/webhooks/blockcypher/route.ts'), 'utf8');
assert.ok(blockcypherWebhook.includes('verifyWorkerAuth(req'), 'BlockCypher webhook must use the shared worker-auth guard');
assert.ok(blockcypherWebhook.includes('checkQueryParam: false'), 'BlockCypher webhook must not accept shared secrets in query strings');
assert.ok(blockcypherWebhook.includes('readBoundedRequestBody'), 'BlockCypher webhook must bound request-body size');
assert.ok(blockcypherWebhook.includes('verifyUtxoDepositOutput'), 'BlockCypher payloads must be checked against independent chain evidence');
assert.ok(blockcypherWebhook.includes('register_pending_deposit'), 'BlockCypher events must register pending deposits only');
assert.ok(blockcypherWebhook.includes('p_confirmations: 0'), 'Webhook-supplied confirmations must never authorize a customer credit');

const alchemyWebhook = readFileSync(resolve(process.cwd(), 'src/app/api/webhooks/alchemy/route.ts'), 'utf8');
assert.ok(alchemyWebhook.includes('if (!SYSTEM_CONFIG.secrets.webhook)'), 'Alchemy webhook must reject requests when its signing secret is missing');
assert.ok(alchemyWebhook.includes('verifySignature(rawBody, signature, SYSTEM_CONFIG.secrets.webhook)'), 'Alchemy webhook must verify the provider signature');
assert.ok(alchemyWebhook.includes('provider.getTransactionReceipt(txHash)'), 'Alchemy payloads must be verified against an independently fetched chain receipt');
assert.ok(alchemyWebhook.includes('register_pending_deposit'), 'Alchemy events must register pending deposits only');
assert.ok(alchemyWebhook.includes('p_confirmations: 0'), 'Alchemy webhook data must never authorize a customer credit');

console.log('Auth and webhook hardening source guards passed.');
