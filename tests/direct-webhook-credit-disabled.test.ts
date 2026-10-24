import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const routes = [
  'src/app/api/webhooks/blockcypher/route.ts',
  'src/app/api/webhooks/litecoin/route.ts',
  'src/app/api/webhooks/alchemy/route.ts',
  'src/app/api/webhooks/deposit/route.ts',
];

for (const path of routes) {
  const source = readFileSync(path, 'utf8');
  assert.match(source, /status:\s*410/, path + ' must return HTTP 410');
  assert.match(source, /DEPOSIT_VERIFICATION_REQUIRED/, path + ' must explain retirement');
  assert.doesNotMatch(source, /\.rpc\(['"]process_deposit_atomic['"]/, path + ' must not call credit RPC');
}

console.log('direct webhook retirement source assertions passed (12 assertions)');
