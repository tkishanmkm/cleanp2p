import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const middleware = readFileSync('src/middleware.ts', 'utf8');
const catchStart = middleware.lastIndexOf('} catch (e) {');
const catchEnd = middleware.indexOf('\n  }\n\n  return supabaseResponse;', catchStart);
const catchBlock = middleware.slice(catchStart, catchEnd);

test('an Auth/network exception cannot bypass protected middleware controls', () => {
  assert.ok(catchStart >= 0 && catchEnd > catchStart);
  assert.match(catchBlock, /Middleware authentication enforcement failed/);
  assert.ok(catchBlock.includes("pathname.startsWith('/api/')"));
  assert.match(catchBlock, /AUTH_SERVICE_UNAVAILABLE/);
  assert.match(catchBlock, /status: 503/);
  assert.match(catchBlock, /authentication_unavailable/);
  assert.doesNotMatch(catchBlock, /Silently continue/);
  assert.ok(!catchBlock.trimEnd().endsWith('return supabaseResponse;'));
});

test('only explicitly public pages, static assets and self-authenticating service endpoints bypass the exception response', () => {
  assert.match(catchBlock, /isStaticAsset/);
  assert.match(catchBlock, /isPublicPage/);
  assert.match(catchBlock, /isSelfAuthenticatingEndpoint/);
  assert.ok(catchBlock.includes("pathname.startsWith('/api/cron/')"));
  assert.ok(catchBlock.includes("pathname.startsWith('/api/webhooks/')"));
  assert.ok(catchBlock.includes("pathname.startsWith('/api/didit/webhook')"));
  assert.ok(catchBlock.includes("pathname.startsWith('/api/kyc/webhook')"));
});
